const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    // Todas las fechas (TIMESTAMP sin zona) se guardan y comparan en hora de Bolivia,
    // aunque el servidor PostgreSQL (p.ej. Docker) esté en UTC.
    options: '-c timezone=America/La_Paz',
    // Las conexiones inactivas no mantienen vivo el proceso (scripts y pruebas)
    allowExitOnIdle: true,
});

// Probar la conexión inicial
// (se libera el cliente de prueba para no dejar una conexión ocupada)
pool.connect()
    .then(client => {
        client.release();
        console.log(`✅ Conexión exitosa a la base de datos PostgreSQL (${process.env.DB_NAME})`);
    })
    .catch(err => console.error('❌ Error al conectar a la base de datos', err.stack));

// ─── Contexto de auditoría ───
// Antes de cada consulta se indica a PostgreSQL quién la hace; los triggers
// de auditoría lo leen con current_setting('sgiv.*').
const contexto = require('../auditoria/contexto');

const FIJAR_CONTEXTO = `SELECT set_config('sgiv.id_usuario', $1, false), set_config('sgiv.usuario', $2, false),
                              set_config('sgiv.ip', $3, false),         set_config('sgiv.origen', $4, false),
                              set_config('sgiv.id_acceso', $5, false)`;

const connect = async () => {
    const c = contexto.actual();
    const client = await pool.connect();
    try {
        await client.query(FIJAR_CONTEXTO, [
            String(c.id_usuario ?? ''), c.usuario ?? '', c.ip ?? '', c.origen ?? '', String(c.id_acceso ?? '')
        ]);
    } catch (e) {
        client.release(e);
        throw e;
    }
    return client;
};

const query = async (texto, params) => {
    const client = await connect();
    try { return await client.query(texto, params); }
    finally { client.release(); }
};

module.exports = { query, connect, end: () => pool.end(), pool };