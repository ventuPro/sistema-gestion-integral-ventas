const db = require('../config/db');

// Función para registrar un nuevo usuario
const crearUsuario = async (userData) => {
    const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash } = userData;
    const query = `
        INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING id_usuario, nombre_completo, correo_electronico;
    `;
    const values = [id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash];
    const result = await db.query(query, values);
    return result.rows[0];
};

// Función para buscar un usuario por su correo (útil para el login)
const obtenerUsuarioPorCorreo = async (correo) => {
    const query = `SELECT * FROM usuario WHERE correo_electronico = $1 AND estado_activo = TRUE;`;
    const result = await db.query(query, [correo]);
    return result.rows[0];
};

module.exports = { crearUsuario, obtenerUsuarioPorCorreo };