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

// Función para buscar un usuario por correo (para login)
const obtenerUsuarioPorCorreo = async (correo) => {
    const query = `SELECT * FROM usuario WHERE correo_electronico = $1 AND estado_activo = TRUE;`;
    const result = await db.query(query, [correo]);
    return result.rows[0];
};

// ─── NUEVAS FUNCIONES ──────────────────────────────────────

// Listar todos los usuarios activos con su rol y sucursal
const obtenerTodosLosUsuarios = async () => {
    const query = `
        SELECT 
            u.id_usuario,
            u.nombre_completo,
            u.correo_electronico,
            u.estado_activo,
            r.nombre_rol,
            r.id_rol,
            s.nombre_sucursal,
            s.id_sucursal
        FROM usuario u
        LEFT JOIN rol_usuario r ON u.id_rol = r.id_rol
        LEFT JOIN sucursal s ON u.id_sucursal = s.id_sucursal
        ORDER BY u.id_usuario DESC;
    `;
    const result = await db.query(query);
    return result.rows;
};

// Obtener todos los roles disponibles (para el formulario de creación)
const obtenerRoles = async () => {
    const query = `SELECT id_rol, nombre_rol FROM rol_usuario ORDER BY nivel_permiso ASC;`;
    const result = await db.query(query);
    return result.rows;
};

// Obtener todas las sucursales (para el formulario de creación)
const obtenerSucursales = async () => {
    const query = `SELECT id_sucursal, nombre_sucursal FROM sucursal ORDER BY id_sucursal ASC;`;
    const result = await db.query(query);
    return result.rows;
};

// Actualizar datos de un usuario (sin cambiar contraseña)
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

// Desactivar un usuario (borrado lógico, nunca físico)
const desactivarUsuario = async (id_usuario) => {
    const query = `
        UPDATE usuario 
        SET estado_activo = FALSE 
        WHERE id_usuario = $1 
        RETURNING id_usuario, nombre_completo;
    `;
    const result = await db.query(query, [id_usuario]);
    return result.rows[0];
};

module.exports = {
    crearUsuario,
    obtenerUsuarioPorCorreo,
    obtenerTodosLosUsuarios,
    obtenerRoles,
    obtenerSucursales,
    actualizarUsuario,
    desactivarUsuario
};