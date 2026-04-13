require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const { pool: db, initDb } = require('./database');

const app = express();
// when running behind a proxy (like Vercel), express must trust it
// so that req.secure is populated correctly and secure cookies are sent.
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies (useful for future form submissions)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Configuration
app.use(session({
    store: new PgSession({
        pool: db,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'super_secret_key_change_this_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Serve static files (CSS, JS, Images, HTML) from the current directory
app.use(express.static(__dirname));

// Admin Login Page Route
app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Root Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Login Route
app.post('/login', async (req, res) => {
    let { username, password } = req.body;
    if (username) username = username.trim(); // Remove accidental whitespace
    console.log(`Login attempt for: '${username}'`);

    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            if (user.status === 'suspended') {
                return res.status(403).json({ error: 'Account suspended. Contact support.' });
            }
            // 'blocked' users are allowed to login (view-only access)

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role || 'user';
            
            if (user.role === 'admin') {
                res.json({ success: true, redirect: '/admin' });
            } else {
                res.json({ success: true, redirect: '/dashboard' });
            }
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard Route (Protected)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    if (req.session.role === 'admin') {
        return res.redirect('/admin');
    }
    try {
        const initialData = await getDashboardData(req.session.userId);
        const dashboardHtmlPath = path.join(__dirname, 'dashboard.html');
        let html = await fs.readFile(dashboardHtmlPath, 'utf-8');
        const script = `<script>window.__INITIAL_DATA__ = ${JSON.stringify(initialData)}</script>`;
        html = html.replace('</head>', `${script}</head>`);
        res.send(html);
    } catch (err) {
        console.error('Error preparing dashboard:', err);
        res.status(500).send('Could not load dashboard. Please try again later.');
    }
});

// Admin Dashboard Route
app.get('/admin', (req, res) => {
    if (!req.session.userId || req.session.role !== 'admin') {
        return res.redirect('/admin-login');
    }
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

async function getDashboardData(userId) {
    // This function encapsulates the logic to fetch all necessary dashboard data.
    // It can be called by both the initial page load and the polling API.

    // Fetch User Details
    const userRes = await db.query('SELECT full_name, email, phone FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    // Fetch Accounts
    const accountsRes = await db.query('SELECT * FROM accounts WHERE user_id = $1', [userId]);
    const accounts = accountsRes.rows;

    // Calculate Net Worth
    const netWorth = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance), 0);

    // Fetch Recent Transactions (Limit 5)
    // Joining with accounts to ensure we only get transactions for this user's accounts
    const transactionsRes = await db.query(`
        SELECT t.*, a.account_name 
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = $1
        ORDER BY t.date DESC LIMIT 5
    `, [userId]);

    // Fetch External Accounts
    const extAccountsRes = await db.query('SELECT * FROM external_accounts WHERE user_id = $1', [userId]);

    // Fetch Notifications
    const notificationsRes = await db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);

    // Fetch Recipients
    const recipientsRes = await db.query('SELECT * FROM recipients WHERE user_id = $1 ORDER BY name ASC', [userId]);

    // Fetch Spending Last 7 Days
    const spendingRes = await db.query(`
        SELECT DATE(t.date) as date, SUM(t.amount) as total
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = $1 AND t.type = 'Debit' AND t.date >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(t.date)
        ORDER BY DATE(t.date)
    `, [userId]);

    // Fetch Savings Goals
    const savingsGoalsRes = await db.query('SELECT * FROM savings_goals WHERE user_id = $1 ORDER BY created_at DESC', [userId]);

    return {
        user: user,
        netWorth: netWorth,
        accounts: accounts,
        transactions: transactionsRes.rows,
        externalAccounts: extAccountsRes.rows,
        notifications: notificationsRes.rows,
        recipients: recipientsRes.rows,
        spending: spendingRes.rows,
        savingsGoals: savingsGoalsRes.rows
    };
}

// API: Get Dashboard Data
app.get('/api/dashboard-data', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const data = await getDashboardData(req.session.userId);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Get All Transactions (History)
app.get('/api/transactions', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const transactionsRes = await db.query(`
            SELECT t.*, a.account_name, a.account_number
            FROM transactions t
            JOIN accounts a ON t.account_id = a.id
            WHERE a.user_id = $1
            ORDER BY t.date DESC
        `, [req.session.userId]);
        res.json({ transactions: transactionsRes.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Internal Transfer
app.post('/api/transfer', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    // Check for suspension
    const userCheck = await db.query('SELECT status FROM users WHERE id = $1', [req.session.userId]);
    if (['suspended', 'blocked'].includes(userCheck.rows[0].status)) {
        const status = userCheck.rows[0].status;
        const message = status === 'suspended' 
            ? 'Account suspended. Contact support.' 
            : 'Unable to perform transaction. Please reach out to Customer Support.';
        return res.status(403).json({ error: message });
    }
    
    const { fromAccountId, toAccountId, amount } = req.body;

    // More robust validation to ensure IDs are integers
    if (!fromAccountId || !toAccountId || isNaN(parseInt(fromAccountId)) || isNaN(parseInt(toAccountId)) || isNaN(parseFloat(amount))) {
        return res.status(400).json({ error: 'Invalid transfer details provided.' });
    }

    const transferAmount = parseFloat(amount);
    const fromId = parseInt(fromAccountId);
    const toId = parseInt(toAccountId);

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Deduct from source
        await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [transferAmount, fromId]);
        // 2. Add to destination
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [transferAmount, toId]);
        
        // 3. Log transactions
        await client.query("INSERT INTO transactions (account_id, type, description, amount) VALUES ($1, 'Debit', 'Transfer Out', $2)", [fromId, transferAmount]);
        await client.query("INSERT INTO transactions (account_id, type, description, amount) VALUES ($1, 'Credit', 'Transfer In', $2)", [toId, transferAmount]);

        await client.query("INSERT INTO notifications (user_id, message) VALUES ($1, $2)", [req.session.userId, `Transfer of $${transferAmount.toFixed(2)} successful.`]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Transfer successful' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Transfer failed' });
    } finally {
        client.release();
    }
});

// API: Zelle / External Send
app.post('/api/zelle', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    // Check for suspension
    const userCheck = await db.query('SELECT status FROM users WHERE id = $1', [req.session.userId]);
    if (['suspended', 'blocked'].includes(userCheck.rows[0].status)) {
        const status = userCheck.rows[0].status;
        const message = status === 'suspended' 
            ? 'Account suspended. Contact support.' 
            : 'Unable to perform transaction. Please reach out to Customer Support.';
        return res.status(403).json({ error: message });
    }

    const { recipient, amount } = req.body;
    const userId = req.session.userId;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Get primary checking account (simplified)
        const accRes = await client.query("SELECT id FROM accounts WHERE user_id = $1 AND type = 'Checking' LIMIT 1", [userId]);
        if (accRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No checking account found' });
        }
        
        const accountId = accRes.rows[0].id;
        const sendAmount = parseFloat(amount);

        // Deduct and Log
        await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [sendAmount, accountId]);
        await client.query("INSERT INTO transactions (account_id, type, description, amount) VALUES ($1, 'Debit', $2, $3)", [accountId, `Zelle to ${recipient}`, sendAmount]);

        // Create Notification
        await client.query("INSERT INTO notifications (user_id, message) VALUES ($1, $2)", [req.session.userId, `Zelle payment of $${sendAmount.toFixed(2)} to ${recipient} sent.`]);

        await client.query('COMMIT');
        res.json({ success: true, message: `Sent $${sendAmount} to ${recipient}` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Payment failed' });
    } finally {
        client.release();
    }
});

// API: Link External Account
app.post('/api/external-accounts', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { bankName, routingNumber, accountNumber } = req.body;
    
    try {
        await db.query(
            'INSERT INTO external_accounts (user_id, bank_name, routing_number, account_number) VALUES ($1, $2, $3, $4)',
            [req.session.userId, bankName, routingNumber, accountNumber]
        );

        // Create Notification
        await db.query("INSERT INTO notifications (user_id, message) VALUES ($1, $2)", [req.session.userId, `External account ${bankName} linked successfully.`]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to link account' });
    }
});

// API: Unlink External Account
app.delete('/api/external-accounts/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        await db.query('DELETE FROM external_accounts WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to unlink' });
    }
});

// API: Update Profile
app.post('/api/settings/profile', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { email, phone } = req.body;
    try {
        await db.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.session.userId]);
        
        // Create Notification
        await db.query("INSERT INTO notifications (user_id, message) VALUES ($1, $2)", [req.session.userId, `Profile information updated.`]);

        // Note: Phone column might need to be added to users table if not present, assuming it is based on previous context
        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// API: Update Password
app.post('/api/settings/password', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body;

    try {
        // Get user to verify current password
        const userRes = await db.query('SELECT password FROM users WHERE id = $1', [req.session.userId]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const user = userRes.rows[0];
        const match = await bcrypt.compare(currentPassword, user.password);

        if (!match) {
            return res.status(400).json({ error: 'Incorrect current password' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.session.userId]);

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

// API: Add Recipient
app.post('/api/recipients', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { name, email } = req.body;
    
    try {
        await db.query(
            'INSERT INTO recipients (user_id, name, email) VALUES ($1, $2, $3)',
            [req.session.userId, name, email]
        );
        res.json({ success: true, message: 'Recipient added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add recipient' });
    }
});

// API: Mark Notification as Read
app.patch('/api/notifications/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { id } = req.params;
    const { is_read } = req.body;
    
    try {
        // First verify the notification belongs to the user
        const notifRes = await db.query(
            'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
            [id, req.session.userId]
        );
        
        if (notifRes.rows.length === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        
        // Update the notification
        await db.query(
            'UPDATE notifications SET is_read = $1 WHERE id = $2',
            [is_read, id]
        );
        
        res.json({ success: true, message: 'Notification updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

// --- ADMIN APIs ---

// Get All Users
app.get('/api/admin/users', async (req, res) => {
    if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    try {
        const result = await db.query(`
            SELECT id, username, full_name, email, status, created_at 
            FROM users 
            WHERE role != 'admin' 
            ORDER BY created_at DESC
        `);
        res.json({ users: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Toggle User Status (Suspend/Activate)
app.patch('/api/admin/users/:id/status', async (req, res) => {
    if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { status } = req.body; // 'active' or 'suspended'
    try {
        await db.query('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// Get Contact Messages
app.get('/api/admin/messages', async (req, res) => {
    if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    try {
        const result = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
        res.json({ messages: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Public Contact Form Submission
app.post('/api/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    try {
        await db.query(
            'INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)',
            [name, email, subject, message]
        );
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// API 404 Handler (Returns JSON for API errors)
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Handle 404 - Page Not Found
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Global Error Handler (Helps debug Vercel 500 errors)
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

if (require.main === module) {
    const startServer = async () => {
        try {
            await initDb(); // Wait for the database to be ready

            const server = app.listen(PORT, () => {
                console.log(`Server is running on http://localhost:${PORT}`);
            });

            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`\nError: Port ${PORT} is already in use.`);
                } else {
                    console.error('An unexpected error occurred:', err);
                }
            });
        } catch (err) {
            console.error('FATAL: Could not connect to the database. Server shutting down.');
            process.exit(1);
        }
    };

    startServer();
}

module.exports = app;