require('dotenv').config();
const { pool: db } = require('./database');
const bcrypt = require('bcryptjs');

const setupUser = async () => {
    try {
        console.log('Starting user setup...');
        
        // User data
        const username = 'Eares';
        const password = 'Justelisme123$';
        const fullName = 'Elis Ares';
        const email = 'elisares@yahoo.com';
        const phone = '501-031-3409';
        
        // Check if user already exists and delete if so
        console.log('Checking if user already exists...');
        const existingUser = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            const existingUserId = existingUser.rows[0].id;
            console.log('User already exists. Deleting old data...');
            // Delete transactions first (due to foreign key constraints)
            await db.query('DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1)', [existingUserId]);
            // Delete accounts
            await db.query('DELETE FROM accounts WHERE user_id = $1', [existingUserId]);
            // Delete user
            await db.query('DELETE FROM users WHERE id = $1', [existingUserId]);
            console.log('Old user data deleted.');
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        console.log('Creating user...');
        const userRes = await db.query(
            'INSERT INTO users (username, password, full_name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, hashedPassword, fullName, email, phone]
        );
        
        const userId = userRes.rows[0].id;
        console.log(`User created with ID: ${userId}`);
        
        // Create Checking Account
        console.log('Creating Checking Account...');
        const checkingRes = await db.query(
            'INSERT INTO accounts (user_id, account_name, account_number, type, balance) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, 'Checking Account', '157525054771', 'Checking', 390000.00]
        );
        const checkingAccountId = checkingRes.rows[0].id;
        console.log(`Checking Account created with ID: ${checkingAccountId}`);
        
        // Create transaction history for Checking Account with specific dates
        console.log('Creating transaction history for Checking Account...');
        const checkingTransactions = [
            { 
                type: 'Credit', 
                description: 'DEPOSIT', 
                amount: 350000.00, 
                date: new Date('2025-03-02')  // March 2, 2025
            },
            { 
                type: 'Credit', 
                description: 'INTEREST DEPOSIT', 
                amount: 14000.00, 
                date: new Date('2021-02-02')  // February 2, 2021
            },
            { 
                type: 'Credit', 
                description: 'INTEREST DEPOSIT', 
                amount: 15000.00, 
                date: new Date('2022-04-10')  // April 10, 2022
            },
            { 
                type: 'Credit', 
                description: 'INTEREST DEPOSIT', 
                amount: 11000.00, 
                date: new Date('2023-07-04')  // July 4, 2023
            }
        ];
        
        for (const trans of checkingTransactions) {
            await db.query(
                'INSERT INTO transactions (account_id, type, description, amount, date) VALUES ($1, $2, $3, $4, $5)',
                [checkingAccountId, trans.type, trans.description, trans.amount, trans.date]
            );
        }
        console.log(`Created ${checkingTransactions.length} transactions for Checking Account`);

        // Verify password
        console.log('\nVerifying password...');
        const verifyUser = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
        const savedHash = verifyUser.rows[0].password;
        const isMatch = await bcrypt.compare(password, savedHash);
        if (isMatch) console.log('✅ Password verification successful!');
        else console.error('❌ Password verification FAILED!');

        console.log('\n✅ User setup complete!');
        console.log(`\nUser Details:`);
        console.log(`  Username: ${username}`);
        console.log(`  Password: ${password}`);
        console.log(`  Name: ${fullName}`);
        console.log(`  Email: ${email}`);
        console.log(`  Phone: ${phone}`);
        console.log(`\nAccounts Created:`);
        console.log(`  1. Checking Account: ${checkingAccountId} (Balance: $390,000.00)`);
        console.log(`\nTransactions Created with Dates:`);
        checkingTransactions.forEach((trans, index) => {
            console.log(`  ${index + 1}. ${trans.description}: $${trans.amount.toLocaleString()} on ${trans.date.toLocaleDateString()}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Error setting up user:', error);
        process.exit(1);
    }
};

setupUser();