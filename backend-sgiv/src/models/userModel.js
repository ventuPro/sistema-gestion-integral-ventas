const db = require('../config/db');

const crearUsuario = async (userData) => {
    const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash } = userData;
    const result = await db.query(`
        INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING id_usuario, nombre_completo, correo_electronico
    `, [id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash]);
    return result.rows[0];
};

const obtenerUsuarioPorCorreo = async (correo) => {
    const result = await db.query(
        `SELECT * FROM usuario WHERE correo_electronico=$1 AND estado_activo=TRUE`,
        [correo]
    );
    return result.rows[0];
};

const listarUsuarios = async () => {
    const result = await db.query(`
        SELECT 
            u.id_usuario,
            u.nombre_completo,
            u.correo_electronico,
            u.id_rol,
            u.id_sucursal,
            u.estado_activo,
            u.caja_habilitada,
            r.nombre_rol,
            s.nombre_sucursal
        FROM usuario u
        LEFT JOIN rol_usuario r ON u.id_rol   = r.id_rol
        LEFT JOIN sucursal    s ON u.id_sucursal = s.id_sucursal
        ORDER BY u.id_usuario ASC
    `);
    return result.rows;
};

const actualizarUsuario = async (id_usuario, datos) => {
    const { nombre_completo, correo_electronico, id_rol, id_sucursal } = datos;
    const result = await db.query(`
        UPDATE usuario
        SET nombre_completo=$1, correo_electronico=$2, id_rol=$3, id_sucursal=$4
        WHERE id_usuario=$5
        RETURNING id_usuario, nombre_completo, correo_electronico
    `, [nombre_completo, correo_electronico, id_rol, id_sucursal, id_usuario]);
    return result.rows[0];
};

const desactivarUsuario = async (id_usuario) => {
    const result = await db.query(
        `UPDATE usuario SET estado_activo=FALSE WHERE id_usuario=$1 RETURNING id_usuario`,
        [id_usuario]
    );
    return result.rows[0];
};

const reactivarUsuario = async (id_usuario) => {
    const result = await db.query(
        `UPDATE usuario SET estado_activo=TRUE WHERE id_usuario=$1 RETURNING id_usuario`,
        [id_usuario]
    );
    return result.rows[0];
};

const cambiarContrasena = async (id_usuario, contrasena_hash) => {
    const result = await db.query(
        `UPDATE usuario SET contrasena_hash=$1 WHERE id_usuario=$2 RETURNING id_usuario`,
        [contrasena_hash, id_usuario]
    );
    return result.rows[0];
};

const obtenerRoles = async () => {
    const result = await db.query(`SELECT id_rol, nombre_rol FROM rol_usuario ORDER BY id_rol`);
    return result.rows;
};

const obtenerSucursales = async () => {
    const result = await db.query(`SELECT id_sucursal, nombre_sucursal FROM sucursal ORDER BY id_sucursal`);
    return result.rows;
};

module.exports = {
    crearUsuario, obtenerUsuarioPorCorreo, listarUsuarios,
    actualizarUsuario, desactivarUsuario, reactivarUsuario,
    cambiarContrasena, obtenerRoles, obtenerSucursales
};