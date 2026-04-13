const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dns = require('dns');
require('dotenv').config();

// Force IPv4 resolution to prevent connection timeouts with IPv6
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

if (!process.env.DATABASE_URL) {
    console.error('FATAL ERROR: DATABASE_URL is not defined in your environment. Please create a .env file and add the connection string.');
    process.exit(1); // Exit the application
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// Handle unexpected pool errors
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

const initDb = async () => {
    try {
        const client = await pool.connect();
        console.log('Connected to PostgreSQL database.');

        // Create Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(100),
                email VARCHAR(100),
                phone VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Accounts Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                account_name VARCHAR(50) NOT NULL,
                account_number VARCHAR(20) UNIQUE NOT NULL,
                type VARCHAR(20) NOT NULL,
                balance DECIMAL(15, 2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Transactions Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                type VARCHAR(20) NOT NULL,
                description VARCHAR(255) NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create External Accounts Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS external_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                bank_name VARCHAR(100) NOT NULL,
                account_number VARCHAR(50) NOT NULL,
                routing_number VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Notifications Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Recipients Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS recipients (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Savings Goals Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS savings_goals (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                target_amount DECIMAL(15, 2) NOT NULL,
                current_amount DECIMAL(15, 2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Contact Messages Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS contact_messages (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100),
                subject VARCHAR(200),
                message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Subscribers Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create Session Table for connect-pg-simple
        await client.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL,
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            );
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);

        // Add status and role columns to users if they don't exist
        try {
            await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'");
            await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'");
        } catch (err) {
            console.log("Note: Columns might already exist.");
        }

        // Check if 'admin' (lowercase) exists from previous runs and migrate it
        const oldAdminCheck = await client.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (oldAdminCheck.rows.length > 0) {
            // Check if 'Admin' already exists to avoid unique constraint violation
            const newAdminCheck = await client.query('SELECT * FROM users WHERE username = $1', ['Admin']);
            
            if (newAdminCheck.rows.length > 0) {
                console.log("Target user 'Admin' already exists. Deleting legacy 'admin' user...");
                await client.query("DELETE FROM users WHERE username = 'admin'");
            } else {
                console.log("Migrating old 'admin' user to 'Admin'...");
                const hashedPassword = await bcrypt.hash('Brutality@54', 10);
                await client.query("UPDATE users SET username = 'Admin', password = $1, role = 'admin' WHERE username = 'admin'", [hashedPassword]);
            }
        }

        // Check if admin exists, if not create it
        const userCheck = await client.query('SELECT * FROM users WHERE username = $1', ['Admin']);
        if (userCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('Brutality@54', 10);
            const userRes = await client.query(
                'INSERT INTO users (username, password, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
                ['Admin', hashedPassword, 'Admin User', 'admin@icu.com']
            );
            const userId = userRes.rows[0].id;

            // Create default accounts
            await client.query("INSERT INTO accounts (user_id, account_name, account_number, type, balance) VALUES ($1, 'Checking Account', '4589', 'Checking', 24500.00) ON CONFLICT (account_number) DO NOTHING", [userId]);
            await client.query("INSERT INTO accounts (user_id, account_name, account_number, type, balance) VALUES ($1, 'Savings Account', '9921', 'Savings', 100000.00) ON CONFLICT (account_number) DO NOTHING", [userId]);
            
            // Create default notifications
            await client.query("INSERT INTO notifications (user_id, message, is_read) VALUES ($1, 'Welcome to your new online banking dashboard.', FALSE)", [userId]);
            await client.query("INSERT INTO notifications (user_id, message, is_read) VALUES ($1, 'Security Alert: New login detected from Chrome on MacOS.', FALSE)", [userId]);

            // Create a default external account for demonstration
            await client.query("INSERT INTO external_accounts (user_id, bank_name, routing_number, account_number) VALUES ($1, $2, $3, $4)", [userId, 'Chase Bank', '123456789', '8821']);

            // Create default recipients
            await client.query("INSERT INTO recipients (user_id, name, email) VALUES ($1, 'John Doe', 'john@example.com')", [userId]);
            await client.query("INSERT INTO recipients (user_id, name, email) VALUES ($1, 'Alice Miller', 'alice@example.com')", [userId]);
            await client.query("INSERT INTO recipients (user_id, name, email) VALUES ($1, 'Robert King', 'robert@example.com')", [userId]);
            await client.query("INSERT INTO recipients (user_id, name, email) VALUES ($1, 'Sarah Lee', 'sarah@example.com')", [userId]);

            // Create default savings goals
            await client.query("INSERT INTO savings_goals (user_id, name, target_amount, current_amount) VALUES ($1, 'Emergency Fund', 10000.00, 2500.00)", [userId]);
            await client.query("INSERT INTO savings_goals (user_id, name, target_amount, current_amount) VALUES ($1, 'New Car', 15000.00, 5000.00)", [userId]);

            console.log("Default user 'Admin' and accounts created.");
        }

        // Ensure admin has admin role (in case it existed before schema update)
        await client.query("UPDATE users SET role = 'admin' WHERE username = 'Admin'");

        client.release();
    } catch (err) {
        console.error('Database initialization error:', err);
        throw err; // Re-throw to prevent the server from starting in a broken state
    }
};

module.exports = { pool, initDb };