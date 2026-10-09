const db = require('../config/db');

// Sucursales con su horario (dia_semana 1 = lunes … 7 = domingo; horas HH:MM)
const obtenerSucursales = async () => {
    const result = await db.query(`
        SELECT s.*,
               COALESCE(json_agg(json_build_object(
                   'dia_semana',    h.dia_semana,
                   'abierto',       h.abierto,
                   'hora_apertura', to_char(h.hora_apertura, 'HH24:MI'),
                   'hora_cierre',   to_char(h.hora_cierre,   'HH24:MI')
               ) ORDER BY h.dia_semana) FILTER (WHERE h.dia_semana IS NOT NULL), '[]') AS horario
        FROM sucursal s
        LEFT JOIN horario_sucursal h ON h.id_sucursal = s.id_sucursal
        GROUP BY s.id_sucursal
        ORDER BY s.id_sucursal ASC;`);
    return result.rows;
};

const existeNombre = async (nombre, excluirId = null) => {
    const r = await db.query(
        `SELECT 1 FROM sucursal WHERE lower(trim(nombre_sucursal)) = lower(trim($1)) AND id_sucursal IS DISTINCT FROM $2`,
        [nombre, excluirId]);
    return r.rowCount > 0;
};

// Solo se guardan los días enviados; UPSERT para que la auditoría registre solo cambios reales
const guardarHorario = async (client, id_sucursal, horario) => {
    for (const h of horario) {
        await client.query(
            `INSERT INTO horario_sucursal (id_sucursal, dia_semana, abierto, hora_apertura, hora_cierre)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id_sucursal, dia_semana) DO UPDATE
             SET abierto = EXCLUDED.abierto, hora_apertura = EXCLUDED.hora_apertura, hora_cierre = EXCLUDED.hora_cierre`,
            [id_sucursal, h.dia_semana, h.abierto, h.hora_apertura, h.hora_cierre]);
    }
};

const enTransaccion = async (fn) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const crearSucursal = (nombre, direccion, telefono, horario = []) => enTransaccion(async (client) => {
    const r = await client.query(
        `INSERT INTO sucursal (nombre_sucursal, direccion_fisica, telefono_contacto)
         VALUES ($1, $2, $3) RETURNING *;`,
        [nombre, direccion, telefono]);
    await guardarHorario(client, r.rows[0].id_sucursal, horario);
    return r.rows[0];
});

const actualizarSucursal = (id, nombre, direccion, telefono, horario = []) => enTransaccion(async (client) => {
    const r = await client.query(
        `UPDATE sucursal SET nombre_sucursal = $2, direccion_fisica = $3, telefono_contacto = $4
         WHERE id_sucursal = $1 RETURNING *`,
        [id, nombre, direccion, telefono]);
    if (!r.rowCount) return null;
    await guardarHorario(client, id, horario);
    return r.rows[0];
});

/** Motivos por los que no se puede desactivar la sucursal (vacío = se puede). */
const motivosParaNoDesactivar = async (id) => {
    const r = await db.query(`
        SELECT
            (SELECT count(*) FROM sucursal WHERE estado_activo AND id_sucursal <> $1)::int          AS otras_activas,
            (SELECT count(*) FROM usuario  WHERE estado_activo AND id_sucursal = $1)::int          AS usuarios,
            (SELECT count(*) FROM turno_caja WHERE estado_turno = 'Abierto' AND id_sucursal = $1)::int AS turnos,
            (SELECT count(*) FROM cuenta_mesa c JOIN mesa_local m ON m.id_mesa = c.id_mesa
              WHERE c.estado = 'Abierta' AND m.id_sucursal = $1)::int                                AS cuentas`,
        [id]);
    const c = r.rows[0];
    const motivos = [];
    if (!c.otras_activas) motivos.push('es la única sucursal activa');
    if (c.usuarios)       motivos.push(`tiene ${c.usuarios} usuario(s) activo(s) asignado(s)`);
    if (c.turnos)         motivos.push('tiene una caja abierta');
    if (c.cuentas)        motivos.push(`tiene ${c.cuentas} cuenta(s) de mesa abierta(s)`);
    return motivos;
};

const estaActiva = async (id) => {
    const r = await db.query(`SELECT estado_activo FROM sucursal WHERE id_sucursal = $1`, [id]);
    return r.rows[0]?.estado_activo === true;
};

const cambiarEstado = async (id, activo) => {
    const r = await db.query(
        `UPDATE sucursal SET estado_activo = $2 WHERE id_sucursal = $1 RETURNING *`, [id, activo]);
    return r.rows[0] || null;
};

module.exports = {
    obtenerSucursales, existeNombre, crearSucursal, actualizarSucursal, motivosParaNoDesactivar, estaActiva, cambiarEstado
};
