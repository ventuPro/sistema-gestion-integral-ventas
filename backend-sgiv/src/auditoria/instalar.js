const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

// ─── Instalación de la auditoría ───
// 1. Crea la BD de auditoría si no existe y sus tablas.
// 2. En sgiv_db: postgres_fdw, funciones y triggers en todas las tablas.
// Se ejecuta en cada arranque del backend (es idempotente).
const DIR_SQL = path.join(__dirname, 'sql');

const nombreBdAuditoria = () => process.env.AUDIT_DB_NAME || 'sgiv_auditoria';

const conexion = (database) => ({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
});

const conCliente = async (database, fn) => {
    const c = new Client(conexion(database));
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
};

const instalarAuditoria = async () => {
    const bdPrincipal = process.env.DB_NAME;
    const bdAuditoria = nombreBdAuditoria();
    if (!/^[a-z_][a-z0-9_]*$/.test(bdAuditoria))
        throw new Error(`AUDIT_DB_NAME inválido: ${bdAuditoria}`);

    await conCliente(bdPrincipal, async (c) => {
        const r = await c.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [bdAuditoria]);
        if (!r.rowCount) await c.query(`CREATE DATABASE ${bdAuditoria}`);
    });

    await conCliente(bdAuditoria, async (c) => {
        await c.query(`ALTER DATABASE ${bdAuditoria} SET timezone = 'America/La_Paz'`);
        await c.query(fs.readFileSync(path.join(DIR_SQL, 'bd_auditoria.sql'), 'utf8'));
    });

    // El servidor PostgreSQL se conecta a sí mismo: por defecto 'localhost'
    // (también dentro de Docker, donde DB_HOST es el nombre del contenedor).
    return conCliente(bdPrincipal, async (c) => {
        await c.query(fs.readFileSync(path.join(DIR_SQL, 'triggers_sgiv.sql'), 'utf8'));
        await c.query(`SELECT auditoria.configurar_conexion($1, $2, $3, $4, $5)`, [
            process.env.AUDIT_FDW_HOST || 'localhost',
            String(process.env.AUDIT_FDW_PORT || process.env.DB_PORT || 5432),
            bdAuditoria,
            process.env.DB_USER,
            process.env.DB_PASSWORD
        ]);
        const r = await c.query(`SELECT auditoria.activar_en_todas() AS tablas`);
        return { bdAuditoria, tablas: r.rows[0].tablas };
    });
};

// npm run auditoria:instalar
if (require.main === module) {
    instalarAuditoria()
        .then(r => console.log(`✅ Auditoría lista en "${r.bdAuditoria}" (${r.tablas} tablas con triggers)`))
        .catch(e => { console.error('❌ Error instalando la auditoría:', e.message); process.exit(1); });
}

module.exports = { instalarAuditoria, nombreBdAuditoria };
