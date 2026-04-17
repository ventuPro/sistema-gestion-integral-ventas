const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
});

// Probar la conexión inicial
pool.connect()
    .then(() => console.log('✅ Conexión exitosa a la base de datos PostgreSQL (sgiv_db)'))
    .catch(err => console.error('❌ Error al conectar a la base de datos', err.stack));

module.exports = pool;