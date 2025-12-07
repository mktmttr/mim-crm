const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Railway levert deze variabelen automatisch aan als je een MySQL service toevoegt
const dbConfig = {
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'mim_user',
    password: process.env.MYSQLPASSWORD || 'mim_password',
    database: process.env.MYSQLDATABASE || 'railway',
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log("Verbinden met database...");
        
        // Test verbinding
        await pool.query('SELECT 1');
        console.log("Database verbinding succesvol!");

        // Tabellen aanmaken (Auto-Migratie)
        const connection = await pool.getConnection();
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS organizations (
                id CHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                industry VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS deals (
                id CHAR(36) PRIMARY KEY,
                organization_id CHAR(36) NOT NULL,
                title VARCHAR(255) NOT NULL,
                stage VARCHAR(50) DEFAULT 'new',
                amount DECIMAL(10,2),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id CHAR(36) PRIMARY KEY,
                organization_id CHAR(36) NOT NULL,
                deal_id CHAR(36),
                title VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'planning',
                start_date DATE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id CHAR(36) PRIMARY KEY,
                project_id CHAR(36) NOT NULL,
                title VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'todo',
                due_date DATE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check of er data is, anders dummy data toevoegen
        const [rows] = await connection.query('SELECT * FROM organizations LIMIT 1');
        if (rows.length === 0) {
            console.log("Eerste keer: Dummy data toevoegen...");
            await connection.query("INSERT INTO organizations (id, name, industry) VALUES (?, ?, ?)", ['org-1', 'Make It Matter', 'Agency']);
            await connection.query("INSERT INTO organizations (id, name, industry) VALUES (?, ?, ?)", ['org-2', 'Tesla', 'Automotive']);
            await connection.query("INSERT INTO deals (id, organization_id, title, stage, amount) VALUES (?, ?, ?, ?, ?)", ['deal-1', 'org-2', 'Website Redesign', 'negotiation', 5000.00]);
        }

        connection.release();

    } catch (err) {
        console.error("Database fout:", err);
        // Retry logic voor als de database trager opstart dan de app
        setTimeout(initDB, 5000);
    }
}

// Start de DB init
initDB();

// --- ROUTES ---

app.get('/api/dashboard', async (req, res) => {
    if (!pool) return res.status(500).json({error: "Database starting..."});
    try {
        const [orgs] = await pool.query('SELECT * FROM organizations');
        const [deals] = await pool.query('SELECT * FROM deals');
        const [projects] = await pool.query('SELECT * FROM projects');
        const [tasks] = await pool.query('SELECT * FROM tasks');
        res.json({ orgs, deals, projects, tasks });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/deals/:id/win', async (req, res) => {
    if (!pool) return res.status(500).json({error: "Database starting..."});
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const dealId = req.params.id;

        await connection.query('UPDATE deals SET stage = "won" WHERE id = ?', [dealId]);
        const [rows] = await connection.query('SELECT * FROM deals WHERE id = ?', [dealId]);
        const deal = rows[0];

        const projectId = uuidv4();
        await connection.query(
            'INSERT INTO projects (id, organization_id, deal_id, title, start_date) VALUES (?, ?, ?, ?, NOW())',
            [projectId, deal.organization_id, dealId, `Project: ${deal.title}`]
        );

        await connection.query('INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)', [uuidv4(), projectId, 'Kick-off meeting']);
        await connection.query('INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)', [uuidv4(), projectId, 'Setup environment']);

        await connection.commit();
        res.json({ message: 'Deal gewonnen! Project gestart.', projectId });
    } catch (e) {
        await connection.rollback();
        res.status(500).json({ error: e.message });
    } finally {
        connection.release();
    }
});

// Railway geeft automatisch een PORT variable mee
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Make It Matter CRM is online op poort ${PORT}`);
});
