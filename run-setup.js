const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration from your provided details
const adminConfig = {
    user: 'postgres',
    password: 'Knox7707$4417',
    host: 'localhost',
    port: 5432,
    database: 'postgres' // Connecting to default DB to create the new one
};

const targetDbName = 'curve_sms';

async function setupDatabase() {
    console.log('🔄 Connecting to PostgreSQL...');
    const client = new Client(adminConfig);

    try {
        await client.connect();

        // 1. Check if database exists
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${targetDbName}'`);

        if (res.rowCount === 0) {
            console.log(`✨ Database '${targetDbName}' does not exist. Creating...`);
            await client.query(`CREATE DATABASE ${targetDbName}`);
            console.log(`✅ Database '${targetDbName}' created successfully.`);
        } else {
            console.log(`ℹ️  Database '${targetDbName}' already exists.`);
        }
    } catch (err) {
        console.error('❌ Error checking/creating database:', err);
        process.exit(1);
    } finally {
        await client.end();
    }

    // 2. Connect to the new database and run setup.sql
    const appConfig = { ...adminConfig, database: targetDbName };
    const appClient = new Client(appConfig);

    try {
        console.log(`🔄 Connecting to '${targetDbName}' to create tables...`);
        await appClient.connect();

        const sqlPath = path.join(__dirname, 'setup.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        await appClient.query(sql);
        console.log('✅ Tables created successfully (setup.sql executed).');

    } catch (err) {
        console.error('❌ Error executing setup.sql:', err);
    } finally {
        await appClient.end();
    }
}

setupDatabase();