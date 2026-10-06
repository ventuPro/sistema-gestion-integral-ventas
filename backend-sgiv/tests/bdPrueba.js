const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// ─── Base de datos temporal para pruebas de integración ───
// Se crea una BD nueva a partir de database/schema.sql + seed.sql, se usa
// durante las pruebas y se elimina al terminar. Nunca se toca la BD real.
const DIR_BD = path.join(__dirname, '..', '..', 'database');

const conexion = (database) => ({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
});

const conAdmin = async (fn) => {
    const c = new Client(conexion(process.env.DB_NAME));
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
};

const crearBdPrueba = async () => {
    const nombre = `sgiv_prueba_${process.pid}_${Date.now()}`;
    try {
        await conAdmin(c => c.query(`CREATE DATABASE ${nombre}`));
    } catch (e) {
        throw new Error(`No se pudo crear la BD de prueba (${e.message}). ` +
                        'Verifique que PostgreSQL esté corriendo y los datos de backend-sgiv/.env.');
    }

    const c = new Client(conexion(nombre));
    await c.connect();
    await c.query(fs.readFileSync(path.join(DIR_BD, 'schema.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(DIR_BD, 'seed.sql'),   'utf8'));

    // La app (config/db.js) lee DB_NAME al cargarse: debe requerirse después de esto
    process.env.DB_NAME_REAL = process.env.DB_NAME;
    process.env.DB_NAME      = nombre;

    return {
        nombre,
        sql: (texto, params) => c.query(texto, params).then(r => r.rows),
        eliminar: async () => {
            await c.end();
            process.env.DB_NAME = process.env.DB_NAME_REAL;
            await conAdmin(a => a.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`));
        }
    };
};

module.exports = { crearBdPrueba };
