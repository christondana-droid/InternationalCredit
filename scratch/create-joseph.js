require('dotenv').config();
const { pool: db } = require('./database');
const bcrypt = require('bcryptjs');

const createJosephUser = async () => {
    try {
        console.log('Starting Joseph Harrison user setup...');
        
        const username = 'Jharrison';
        const password = 'Lovemeonly123@$';
        const fullName = 'Joseph Harrison';
        const email = 'JosephHarrison@yahoo.com';
        const targetBalance = 2321320.00;
        
        // Check if user already exists
        const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            console.log('User already exists. Updating existing user data is safer than deleting if we want to preserve history, but for this task we will replace.');
            const existingUserId = existingUser.rows[0].id;
            await db.query('DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1)', [existingUserId]);
            await db.query('DELETE FROM accounts WHERE user_id = $1', [existingUserId]);
            await db.query('DELETE FROM users WHERE id = $1', [existingUserId]);
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const userRes = await db.query(
            'INSERT INTO users (username, password, full_name, email, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, hashedPassword, fullName, email, 'user']
        );
        const userId = userRes.rows[0].id;
        
        // Create Account
        const accountNumber = '822910384756';
        const accRes = await db.query(
            'INSERT INTO accounts (user_id, account_name, account_number, type, balance) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, 'Premium Checking', accountNumber, 'Checking', targetBalance]
        );
        const accountId = accRes.rows[0].id;
        
        // Generate Transactions
        const transactions = [];
        let runningBalance = 0;
        
        const addTransaction = (date, type, description, amount) => {
            amount = parseFloat(amount);
            transactions.push({ date, type, description, amount });
            if (type === 'Credit') runningBalance += amount;
            else runningBalance -= amount;
        };

        // 1. Large Initial Deposit (6 months ago)
        addTransaction(new Date('2025-10-15'), 'Credit', 'INITIAL BULK DEPOSIT', 1800000.00);
        
        // 2. Series of Interest and Deposits
        addTransaction(new Date('2025-11-01'), 'Credit', 'INTEREST CREDIT', 2500.00);
        addTransaction(new Date('2025-11-15'), 'Credit', 'WIRE TRANSFER INBOUND', 150000.00);
        addTransaction(new Date('2025-12-01'), 'Credit', 'INTEREST CREDIT', 2800.00);
        addTransaction(new Date('2025-12-10'), 'Debit', 'ONLINE PURCHASE - AMZ', 1250.50);
        addTransaction(new Date('2025-12-20'), 'Credit', 'BULK DEPOSIT', 200000.00);
        addTransaction(new Date('2026-01-01'), 'Credit', 'INTEREST CREDIT', 3100.00);
        addTransaction(new Date('2026-01-15'), 'Debit', 'WIRE TRANSFER OUTBOUND', 50000.00);
        addTransaction(new Date('2026-02-01'), 'Credit', 'INTEREST CREDIT', 3200.00);
        addTransaction(new Date('2026-02-14'), 'Credit', 'DIVIDEND PAYMENT', 85000.00);
        addTransaction(new Date('2026-03-01'), 'Credit', 'INTEREST CREDIT', 3400.00);
        addTransaction(new Date('2026-03-10'), 'Debit', 'LUXURY AUTO LEASE', 4500.00);
        addTransaction(new Date('2026-03-25'), 'Credit', 'QUARTERLY REBATE', 12000.00);
        addTransaction(new Date('2026-04-01'), 'Credit', 'INTEREST CREDIT', 3800.00);
        
        // Calculate Adjustment to hit exactly $2,321,320.00
        const adjustment = targetBalance - runningBalance;
        if (adjustment !== 0) {
            const adjType = adjustment > 0 ? 'Credit' : 'Debit';
            addTransaction(new Date('2026-04-10'), adjType, 'SYSTEM BALANCE ADJUSTMENT', Math.abs(adjustment));
        }

        // Batch insert transactions
        for (const t of transactions) {
            await db.query(
                'INSERT INTO transactions (account_id, type, description, amount, date) VALUES ($1, $2, $3, $4, $5)',
                [accountId, t.type, t.description, t.amount, t.date]
            );
        }
        
        // Notifications
        await db.query("INSERT INTO notifications (user_id, message) VALUES ($1, 'Welcome to International Credit Union, Mr. Harrison.')", [userId]);
        await db.query("INSERT INTO notifications (user_id, message) VALUES ($1, 'Your account has been upgraded to Premium status based on your balance.')", [userId]);
        
        console.log(`Successfully created user ${username} with balance $${targetBalance.toLocaleString()}`);
        console.log(`Created ${transactions.length} transactions in history.`);
        
        process.exit(0);
    } catch (err) {
        console.error('Error creating user:', err);
        process.exit(1);
    }
};

createJosephUser();
