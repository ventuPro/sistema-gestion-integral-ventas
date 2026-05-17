const db = require('../config/db');

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

const MODULOS = ['dashboard','punto_venta','mesas','arqueo','inventario','reportes','usuarios','cocina'];

const obtenerPermisosEfectivos = async (id_usuario, id_rol) => {
    // Admin tiene todo
    if (Number(id_rol) === 1) {
        const permisos = {};
        MODULOS.forEach(m => permisos[m] = true);
        return permisos;
    }

    try {
        const r = await db.query(
            `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
            [id_usuario]
        );

        if (r.rows.length > 0) {
            // Tiene permisos guardados — usar esos
            const permisos = {};
            MODULOS.forEach(m => permisos[m] = false);
            r.rows.forEach(row => {
                // FIX: asegurar que es boolean, no string
                permisos[row.modulo] = row.tiene_acceso === true || row.tiene_acceso === 'true';
            });
            return permisos;
        }

        // Sin permisos guardados → usar defaults del rol
        return { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    } catch (e) {
        console.error('obtenerPermisosEfectivos error:', e.message);
        // Si falla la DB, usar defaults para no bloquear el login
        return { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    }
};

const obtenerPermisosUsuario = async (id_usuario, id_rol) => {
    const base = { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    MODULOS.forEach(m => { if (!(m in base)) base[m] = false; });

    try {
        const r = await db.query(
            `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
            [id_usuario]
        );
        if (r.rows.length > 0) {
            MODULOS.forEach(m => base[m] = false);
            r.rows.forEach(row => {
                base[row.modulo] = row.tiene_acceso === true || row.tiene_acceso === 'true';
            });
        }
    } catch (e) {
        console.error('obtenerPermisosUsuario error:', e.message);
    }

    return base;
};

const guardarPermisosUsuario = async (id_usuario, permisos) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM permiso_usuario WHERE id_usuario = $1`, [id_usuario]);

        for (const [modulo, tiene_acceso] of Object.entries(permisos)) {
            await client.query(`
                INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso)
                VALUES ($1, $2, $3)
            `, [id_usuario, modulo, Boolean(tiene_acceso)]);
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

module.exports = { obtenerPermisosEfectivos, obtenerPermisosUsuario, guardarPermisosUsuario };