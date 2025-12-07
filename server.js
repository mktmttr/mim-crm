const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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
        await pool.query('SELECT 1');
        console.log("Database verbinding succesvol!");

        const connection = await pool.getConnection();
        
        // Tabellen aanmaken (inclusief CONTACTS)
        await connection.query(`CREATE TABLE IF NOT EXISTS organizations (id CHAR(36) PRIMARY KEY, name VARCHAR(255), industry VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS contacts (id CHAR(36) PRIMARY KEY, organization_id CHAR(36), first_name VARCHAR(100), last_name VARCHAR(100), email VARCHAR(255), phone VARCHAR(50), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS deals (id CHAR(36) PRIMARY KEY, organization_id CHAR(36), title VARCHAR(255), stage VARCHAR(50) DEFAULT 'new', amount DECIMAL(10,2), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS projects (id CHAR(36) PRIMARY KEY, organization_id CHAR(36), deal_id CHAR(36), title VARCHAR(255), status VARCHAR(50) DEFAULT 'planning', start_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        await connection.query(`CREATE TABLE IF NOT EXISTS tasks (id CHAR(36) PRIMARY KEY, project_id CHAR(36), title VARCHAR(255), status VARCHAR(50) DEFAULT 'todo', due_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

        connection.release();
    } catch (err) {
        console.error("Database fout:", err);
        setTimeout(initDB, 5000);
    }
}

initDB();

// --- ROUTES ---

// Dashboard Data (Alles ophalen)
app.get('/api/dashboard', async (req, res) => {
    if (!pool) return res.status(500).json({error: "DB loading"});
    try {
        const [orgs] = await pool.query('SELECT * FROM organizations ORDER BY created_at DESC');
        
        // We halen nu ook de contacten op
        const [contacts] = await pool.query(`
            SELECT c.*, o.name as org_name 
            FROM contacts c 
            LEFT JOIN organizations o ON c.organization_id = o.id 
            ORDER BY c.created_at DESC
        `);

        const [deals] = await pool.query(`
            SELECT d.*, o.name as org_name 
            FROM deals d 
            LEFT JOIN organizations o ON d.organization_id = o.id 
            ORDER BY d.created_at DESC
        `);

        const [projects] = await pool.query(`
            SELECT p.*, o.name as org_name 
            FROM projects p 
            LEFT JOIN organizations o ON p.organization_id = o.id 
            ORDER BY p.created_at DESC
        `);

        const [tasks] = await pool.query('SELECT * FROM tasks');
        
        res.json({ orgs, contacts, deals, projects, tasks });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Organisatie Maken
app.post('/api/organizations', async (req, res) => {
    try {
        const { name, industry } = req.body;
        const id = uuidv4();
        await pool.query('INSERT INTO organizations (id, name, industry) VALUES (?, ?, ?)', [id, name, industry]);
        res.json({ message: 'Organisatie toegevoegd', id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// NIEUW: Contact Maken
app.post('/api/contacts', async (req, res) => {
    try {
        const { organization_id, first_name, last_name, email } = req.body;
        const id = uuidv4();
        await pool.query('INSERT INTO contacts (id, organization_id, first_name, last_name, email) VALUES (?, ?, ?, ?, ?)', 
            [id, organization_id, first_name, last_name, email]);
        res.json({ message: 'Contact toegevoegd', id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deal Maken
app.post('/api/deals', async (req, res) => {
    try {
        const { organization_id, title, amount } = req.body;
        const id = uuidv4();
        await pool.query('INSERT INTO deals (id, organization_id, title, amount) VALUES (?, ?, ?, ?)', [id, organization_id, title, amount]);
        res.json({ message: 'Deal toegevoegd', id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Win Deal
app.put('/api/deals/:id/win', async (req, res) => {
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
        await connection.query('INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)', [uuidv4(), projectId, 'Strategie & Design']);
        await connection.query('INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)', [uuidv4(), projectId, 'Development']);

        await connection.commit();
        res.json({ message: 'Deal gewonnen!', projectId });
    } catch (e) {
        await connection.rollback();
        res.status(500).json({ error: e.message });
    } finally {
        connection.release();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`App running on port ${PORT}`));
