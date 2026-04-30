const db = require('../config/db');

// Módulos disponibles del sistema
const MODULOS_SISTEMA = [
    'dashboard', 'inventario', 'punto_venta', 'mesas',
    'arqueo', 'reportes', 'usuarios', 'cocina'
];

// Permisos por defecto según rol
const PERMISOS_DEFAULT = {
    1: { // Administrador — acceso total
        dashboard: true, inventario: true, punto_venta: true, mesas: true,
        arqueo: true, reportes: true, usuarios: true, cocina: false
    },
    2: { // Cajero — acceso limitado por defecto
        dashboard: false, inventario: false, punto_venta: true, mesas: true,
        arqueo: false, reportes: false, usuarios: false, cocina: false
    },
    3: { // Cocina — solo cocina
        dashboard: false, inventario: false, punto_venta: false, mesas: false,
        arqueo: false, reportes: false, usuarios: false, cocina: true
    }
};

const obtenerPermisosUsuario = async (id_usuario) => {
    const query = `
        SELECT modulo, tiene_acceso
        FROM permiso_usuario
        WHERE id_usuario = $1;
    `;
    const result = await db.query(query, [id_usuario]);

    // Si no tiene permisos configurados, retornar vacío
    const permisos = {};
    result.rows.forEach(row => {
        permisos[row.modulo] = row.tiene_acceso;
    });
    return permisos;
};

// Obtener permisos efectivos: combina defaults del rol + overrides de la tabla
const obtenerPermisosEfectivos = async (id_usuario, id_rol) => {
    const defaults   = PERMISOS_DEFAULT[id_rol] || {};
    const overrides  = await obtenerPermisosUsuario(id_usuario);

    // Los overrides de la tabla prevalecen sobre los defaults
    const efectivos = { ...defaults, ...overrides };
    return efectivos;
};

const guardarPermisosUsuario = async (id_usuario, permisos) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // Borrar permisos existentes del usuario
        await client.query('DELETE FROM permiso_usuario WHERE id_usuario = $1', [id_usuario]);

        // Insertar nuevos permisos
        for (const [modulo, tiene_acceso] of Object.entries(permisos)) {
            if (MODULOS_SISTEMA.includes(modulo)) {
                await client.query(
                    `INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso)
                     VALUES ($1, $2, $3);`,
                    [id_usuario, modulo, tiene_acceso]
                );
            }
        }
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { MODULOS_SISTEMA, PERMISOS_DEFAULT, obtenerPermisosUsuario, obtenerPermisosEfectivos, guardarPermisosUsuario };