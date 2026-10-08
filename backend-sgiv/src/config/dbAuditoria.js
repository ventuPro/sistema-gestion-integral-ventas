const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

// ─── Conexión directa a la BD de auditoría (registro de accesos) ───
const pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    database: process.env.AUDIT_DB_NAME || 'sgiv_auditoria',
    port:     process.env.DB_PORT,
    allowExitOnIdle: true,
});

// Si la BD de auditoría se reinicia, una conexión inactiva caída no debe tumbar el backend
pool.on('error', e => console.error('Auditoría (conexión inactiva):', e.message));

module.exports = pool;
