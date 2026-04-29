const db = require('../config/db');

const crearUsuario = async (userData) => {
    const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash } = userData;
    const query = `
        INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING id_usuario, nombre_completo, correo_electronico;
    `;
    const result = await db.query(query, [id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash]);
    return result.rows[0];
};

const obtenerUsuarioPorCorreo = async (correo) => {
    const query = `SELECT * FROM usuario WHERE correo_electronico = $1 AND estado_activo = TRUE;`;
    const result = await db.query(query, [correo]);
    return result.rows[0];
};

const obtenerTodosLosUsuarios = async () => {
    const query = `
        SELECT 
            u.id_usuario, u.nombre_completo, u.correo_electronico, u.estado_activo,
            r.nombre_rol, r.id_rol, r.nivel_permiso,
            s.nombre_sucursal, s.id_sucursal
        FROM usuario u
        LEFT JOIN rol_usuario r ON u.id_rol = r.id_rol
        LEFT JOIN sucursal s ON u.id_sucursal = s.id_sucursal
        ORDER BY u.id_usuario DESC;
    `;
    const result = await db.query(query);
    return result.rows;
};

const obtenerRoles = async () => {
    const query = `SELECT id_rol, nombre_rol, nivel_permiso FROM rol_usuario ORDER BY nivel_permiso ASC;`;
    const result = await db.query(query);
    return result.rows;
};

const obtenerSucursales = async () => {
    const query = `SELECT id_sucursal, nombre_sucursal FROM sucursal ORDER BY id_sucursal ASC;`;
    const result = await db.query(query);
    return result.rows;
};

const actualizarUsuario = async (id_usuario, datos) => {
    const { nombre_completo, correo_electronico, id_rol, id_sucursal } = datos;
    const query = `
        UPDATE usuario 
        SET nombre_completo = $1, correo_electronico = $2, id_rol = $3, id_sucursal = $4
        WHERE id_usuario = $5
        RETURNING id_usuario, nombre_completo, correo_electronico;
    `;
    const result = await db.query(query, [nombre_completo, correo_electronico, id_rol, id_sucursal, id_usuario]);
    return result.rows[0];
};

const desactivarUsuario = async (id_usuario) => {
    const query = `UPDATE usuario SET estado_activo = FALSE WHERE id_usuario = $1 RETURNING id_usuario, nombre_completo;`;
    const result = await db.query(query, [id_usuario]);
    return result.rows[0];
};

// NUEVO: Reactivar usuario
const reactivarUsuario = async (id_usuario) => {
    const query = `UPDATE usuario SET estado_activo = TRUE WHERE id_usuario = $1 RETURNING id_usuario, nombre_completo;`;
    const result = await db.query(query, [id_usuario]);
    return result.rows[0];
};

// NUEVO: Cambiar contraseña
const cambiarContrasena = async (id_usuario, contrasena_hash) => {
    const query = `
        UPDATE usuario SET contrasena_hash = $1 WHERE id_usuario = $2 
        RETURNING id_usuario, nombre_completo;
    `;
    const result = await db.query(query, [contrasena_hash, id_usuario]);
    return result.rows[0];
};

module.exports = {
    crearUsuario, obtenerUsuarioPorCorreo, obtenerTodosLosUsuarios,
    obtenerRoles, obtenerSucursales, actualizarUsuario, desactivarUsuario,
    reactivarUsuario, cambiarContrasena
};