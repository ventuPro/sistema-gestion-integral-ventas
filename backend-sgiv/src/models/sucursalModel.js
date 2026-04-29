const db = require('../config/db');

const obtenerSucursales = async () => {
    const result = await db.query(`SELECT * FROM sucursal ORDER BY id_sucursal ASC;`);
    return result.rows;
};

const crearSucursal = async (nombre, direccion, telefono) => {
    const result = await db.query(
        `INSERT INTO sucursal (nombre_sucursal, direccion_fisica, telefono_contacto)
         VALUES ($1, $2, $3) RETURNING *;`,
        [nombre, direccion, telefono]
    );
    return result.rows[0];
};

module.exports = { obtenerSucursales, crearSucursal };