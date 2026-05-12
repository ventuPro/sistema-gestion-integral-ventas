const db = require('../config/db');

// Módulos del sistema por defecto según rol
const PERMISOS_DEFAULT = {
    2: { // Cajero
        dashboard:   true,
        punto_venta: true,
        mesas:       true,
        arqueo:      true,
        inventario:  false,
        reportes:    false,
        usuarios:    false,
        cocina:      false
    },
    3: { // Cocina
        dashboard:   false,
        punto_venta: false,
        mesas:       false,
        arqueo:      false,
        inventario:  false,
        reportes:    false,
        usuarios:    false,
        cocina:      true
    }
};

const MODULOS = [
    'dashboard','punto_venta','mesas','arqueo',
    'inventario','reportes','usuarios','cocina'
];

// Obtener permisos efectivos del usuario (combina tabla + defaults)
const obtenerPermisosEfectivos = async (id_usuario, id_rol) => {
    // Admin siempre tiene todo
    if (id_rol === 1) {
        const todos = {};
        MODULOS.forEach(m => todos[m] = true);
        return todos;
    }

    // Buscar permisos guardados en tabla
    const result = await db.query(
        `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
        [id_usuario]
    );

    // Si tiene registros en tabla, usar esos
    if (result.rows.length > 0) {
        const permisos = {};
        MODULOS.forEach(m => permisos[m] = false);
        result.rows.forEach(r => { permisos[r.modulo] = r.tiene_acceso; });
        return permisos;
    }

    // Si no tiene registros, usar defaults del rol
    return PERMISOS_DEFAULT[id_rol] || {};
};

// Obtener permisos de un usuario específico (para el admin editarlos)
const obtenerPermisosUsuario = async (id_usuario, id_rol) => {
    const result = await db.query(
        `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
        [id_usuario]
    );

    const base = PERMISOS_DEFAULT[id_rol] || {};
    const permisos = { ...base };

    if (result.rows.length > 0) {
        MODULOS.forEach(m => permisos[m] = false);
        result.rows.forEach(r => { permisos[r.modulo] = r.tiene_acceso; });
    }

    return permisos;
};

// Guardar permisos de un usuario (upsert)
const guardarPermisosUsuario = async (id_usuario, permisos) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Eliminar permisos anteriores
        await client.query(
            `DELETE FROM permiso_usuario WHERE id_usuario = $1`,
            [id_usuario]
        );

        // Insertar nuevos
        for (const [modulo, tiene_acceso] of Object.entries(permisos)) {
            await client.query(
                `INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso)
                 VALUES ($1, $2, $3)`,
                [id_usuario, modulo, tiene_acceso]
            );
        }

        await client.query('COMMIT');
        return permisos;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    obtenerPermisosEfectivos,
    obtenerPermisosUsuario,
    guardarPermisosUsuario
};