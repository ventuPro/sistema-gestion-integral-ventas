const db = require('../config/db');

const PERMISOS_DEFAULT = {
    2: { dashboard: true,  punto_venta: true,  mesas: true,  arqueo: true,
         inventario: false, reportes: false, usuarios: false },
    3: { dashboard: false, punto_venta: false, mesas: false, arqueo: false,
         inventario: false, reportes: false, usuarios: false }
};

const MODULOS = ['dashboard','punto_venta','mesas','arqueo','inventario','reportes','usuarios'];

// ────────────────────────────────────────────────────────────────
//  Garantía de esquema: la tabla DEBE existir con el shape correcto.
//  Cacheado por proceso para no pegarle a la BD en cada request.
// ────────────────────────────────────────────────────────────────
let _tablaLista = false;
const asegurarTabla = async () => {
    if (_tablaLista) return;
    await db.query(`
        CREATE TABLE IF NOT EXISTS permiso_usuario (
            id_permiso          SERIAL PRIMARY KEY,
            id_usuario          INTEGER NOT NULL,
            modulo              VARCHAR(50) NOT NULL,
            tiene_acceso        BOOLEAN NOT NULL DEFAULT FALSE,
            fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT permiso_usuario_unique UNIQUE (id_usuario, modulo)
        )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_permiso_usuario_id ON permiso_usuario (id_usuario)`);
    _tablaLista = true;
    console.log('[permisos] Tabla permiso_usuario lista');
};

// ────────────────────────────────────────────────────────────────
//  LECTURA
// ────────────────────────────────────────────────────────────────
const obtenerPermisosEfectivos = async (id_usuario, id_rol) => {
    if (Number(id_rol) === 1) {
        const p = {}; MODULOS.forEach(m => p[m] = true); return p;
    }
    try {
        await asegurarTabla();
        const r = await db.query(
            `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
            [Number(id_usuario)]
        );
        if (r.rows.length > 0) {
            const p = {}; MODULOS.forEach(m => p[m] = false);
            r.rows.forEach(row => { p[row.modulo] = row.tiene_acceso === true; });
            return p;
        }
        return { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    } catch (e) {
        console.error('[permisos] obtenerPermisosEfectivos:', e.message);
        return { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    }
};

const obtenerPermisosUsuario = async (id_usuario, id_rol) => {
    const base = { ...(PERMISOS_DEFAULT[Number(id_rol)] || {}) };
    MODULOS.forEach(m => { if (!(m in base)) base[m] = false; });
    try {
        await asegurarTabla();
        const r = await db.query(
            `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
            [Number(id_usuario)]
        );
        if (r.rows.length > 0) {
            MODULOS.forEach(m => base[m] = false);
            r.rows.forEach(row => { base[row.modulo] = row.tiene_acceso === true; });
        }
    } catch (e) {
        console.error('[permisos] obtenerPermisosUsuario:', e.message);
    }
    return base;
};

// ────────────────────────────────────────────────────────────────
//  ESCRITURA con UPSERT (atómico, sin transacciones manuales)
//  Mucho más simple = mucho menos margen de error.
// ────────────────────────────────────────────────────────────────
const guardarPermisosUsuario = async (id_usuario, permisos) => {
    // 1. Validación de inputs
    const uid = Number(id_usuario);
    if (!Number.isFinite(uid) || uid <= 0) {
        throw new Error('id_usuario inválido: ' + id_usuario);
    }
    if (!permisos || typeof permisos !== 'object' || Array.isArray(permisos)) {
        throw new Error('permisos debe ser un objeto');
    }

    // 2. Garantizar tabla
    await asegurarTabla();

    // 3. Confirmar que el usuario existe (mejor mensaje de error que FK violation)
    const ru = await db.query('SELECT id_usuario FROM usuario WHERE id_usuario = $1', [uid]);
    if (ru.rows.length === 0) {
        throw new Error(`Usuario ${uid} no existe`);
    }

    // 4. UPSERT por módulo (ON CONFLICT). Esto es atómico a nivel de fila
    //    y no requiere transacción manual.
    const guardados = [];
    for (const modulo of MODULOS) {
        if (!(modulo in permisos)) continue;
        const acceso = Boolean(permisos[modulo]);
        try {
            await db.query(`
                INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso, fecha_actualizacion)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (id_usuario, modulo)
                DO UPDATE SET
                    tiene_acceso        = EXCLUDED.tiene_acceso,
                    fecha_actualizacion = CURRENT_TIMESTAMP
            `, [uid, modulo, acceso]);
            guardados.push({ modulo, acceso });
        } catch (eRow) {
            // Si falla un módulo (ej: constraint), reportar el módulo culpable
            console.error(`[permisos] UPSERT fallo en módulo "${modulo}" para uid ${uid}:`, eRow.message);
            throw new Error(`Error al guardar módulo "${modulo}": ${eRow.message}`);
        }
    }

    // 5. Releer estado real para devolver al cliente
    const r = await db.query(
        `SELECT modulo, tiene_acceso FROM permiso_usuario WHERE id_usuario = $1`,
        [uid]
    );
    const saved = {};
    MODULOS.forEach(m => saved[m] = false);
    r.rows.forEach(row => { saved[row.modulo] = row.tiene_acceso === true; });

    console.log(`[permisos] ✅ uid=${uid} → ${guardados.length} módulos guardados/actualizados`);
    return saved;
};

module.exports = { obtenerPermisosEfectivos, obtenerPermisosUsuario, guardarPermisosUsuario };
