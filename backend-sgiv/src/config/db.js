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

module.exports = pool;