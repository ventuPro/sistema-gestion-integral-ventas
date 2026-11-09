const db = require('../config/db');
const ajusteModel = require('./ajusteModel');
const loteModel = require('./loteModel');
const { emitirUsuario } = require('../utils/tiempoReal');

// ─── Notificaciones ───
// Se crean dentro de la transacción que las origina y se envían recién al confirmarse
// (si la operación falla, no queda aviso). El administrador ve todas; el cajero, las de
// destino SUCURSAL de su sucursal y las de destino USUARIO dirigidas a él.
// No pasan por la auditoría (son avisos) y se borran a los 7 días.

const DIAS_GUARDADAS = 7;
const HORAS_SIN_REPETIR_STOCK = 3;
const MAX_LISTA = 50;

// Quién puede ver la notificación n siendo el usuario u
const VISIBLE = `(u.id_rol = 1
    OR (n.destino = 'SUCURSAL' AND n.id_sucursal = u.id_sucursal)
    OR (n.destino = 'USUARIO'  AND n.id_usuario  = u.id_usuario))`;

const COLUMNAS = `n.id_notificacion, n.tipo, n.titulo, n.mensaje, n.ruta, n.id_sucursal, n.fecha_creacion`;

// Envíos extra al confirmarse (Telegram se registra aquí)
const oyentes = [];
const alCrear = (fn) => oyentes.push(fn);

const despachar = async (n, leida_por) => {
    const r = await db.query(`
        SELECT u.id_usuario FROM usuario u, (SELECT $1::text AS destino, $2::int AS id_sucursal, $3::int AS id_usuario) n
        WHERE u.estado_activo = TRUE AND ${VISIBLE}`, [n.destino, n.id_sucursal, n.id_usuario]);
    const datos = {
        id_notificacion: n.id_notificacion, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje,
        ruta: n.ruta, id_sucursal: n.id_sucursal, fecha_creacion: n.fecha_creacion
    };
    for (const { id_usuario } of r.rows)
        emitirUsuario(id_usuario, 'notificacion:nueva', { ...datos, leida: id_usuario === leida_por });
    for (const fn of oyentes) await fn({ ...datos, destino: n.destino, id_usuario: n.id_usuario, leida_por });
};

/**
 * cliente: el de la transacción (o db). leida_por: quien la originó (no le queda como no leída).
 * destino: ADMIN | SUCURSAL (id_sucursal) | USUARIO (id_usuario).
 */
const crear = async (cliente, { tipo, titulo, mensaje, ruta = null, destino = 'ADMIN',
                                id_sucursal = null, id_usuario = null, id_producto = null, leida_por = null }) => {
    const r = await cliente.query(`
        WITH n AS (
            INSERT INTO notificacion (tipo, titulo, mensaje, ruta, destino, id_sucursal, id_usuario, id_producto)
            VALUES ($1, left($2, 80), left($3, 300), $4, $5, $6, $7, $8) RETURNING *
        ), l AS (
            INSERT INTO notificacion_leida (id_notificacion, id_usuario)
            SELECT id_notificacion, $9::int FROM n WHERE $9::int IS NOT NULL
        )
        SELECT * FROM n
    `, [tipo, titulo, mensaje, ruta, destino, id_sucursal, id_usuario, id_producto, leida_por]);
    const n = r.rows[0];
    const enviar = () => despachar(n, leida_por).catch(e => console.error('notificacion:', e.message));
    if (Array.isArray(cliente.alConfirmar)) cliente.alConfirmar.push(enviar);
    else setImmediate(enviar);
    return n;
};

const dinero = async (monto) => `${(await ajusteModel.parametros()).moneda_simbolo} ${Math.abs(Number(monto)).toFixed(2)}`;

// ─── Eventos ───

/** Tras una salida de stock: avisa si cruzó el mínimo de Ajustes o se agotó (una vez cada 3 horas por producto) */
const revisarStock = async (cliente, { id_inventario, antes, despues }) => {
    const minimo = Number((await ajusteModel.parametros()).stock_minimo_defecto) || 0;
    const agotado = despues <= 0 && antes > 0;
    if (!agotado && !(despues <= minimo && antes > minimo)) return;
    const tipo = agotado ? 'AGOTADO' : 'STOCK_BAJO';

    const r = await cliente.query(`
        SELECT i.id_sucursal, i.id_producto, p.nombre_producto, s.nombre_sucursal,
               EXISTS (SELECT 1 FROM notificacion n
                       WHERE n.tipo = $2 AND n.id_producto = i.id_producto AND n.id_sucursal = i.id_sucursal
                         AND n.fecha_creacion > CURRENT_TIMESTAMP - make_interval(hours => $3)) AS repetida
        FROM inventario_sucursal i
        JOIN producto p ON p.id_producto = i.id_producto
        JOIN sucursal s ON s.id_sucursal = i.id_sucursal
        WHERE i.id_inventario = $1`, [id_inventario, tipo, HORAS_SIN_REPETIR_STOCK]);
    const i = r.rows[0];
    if (!i || i.repetida) return;

    await crear(cliente, {
        tipo, destino: 'SUCURSAL', id_sucursal: i.id_sucursal, id_producto: i.id_producto, ruta: 'inventario',
        titulo:  agotado ? `Agotado: ${i.nombre_producto}` : `Stock bajo: ${i.nombre_producto}`,
        mensaje: agotado ? `Sin stock en ${i.nombre_sucursal}` : `Quedan ${despues} en ${i.nombre_sucursal}`
    });
};

/** Cierre de caja con efectivo contado distinto del esperado */
const arqueoConDiferencia = async (cliente, id_turno) => {
    const r = await cliente.query(`
        SELECT t.id_turno, t.diferencia, t.id_sucursal, t.id_usuario_cajero, u.nombre_completo, s.nombre_sucursal
        FROM turno_caja t
        JOIN usuario u ON u.id_usuario = t.id_usuario_cajero
        JOIN sucursal s ON s.id_sucursal = t.id_sucursal
        WHERE t.id_turno = $1`, [id_turno]);
    const t = r.rows[0];
    if (!t || t.diferencia === null || Number(t.diferencia) === 0) return;
    await crear(cliente, {
        tipo: 'ARQUEO', id_sucursal: t.id_sucursal, ruta: 'cierres-caja', leida_por: t.id_usuario_cajero,
        titulo:  `${Number(t.diferencia) < 0 ? 'Faltante' : 'Sobrante'} en caja: ${await dinero(t.diferencia)}`,
        mensaje: `${t.nombre_completo} · ${t.nombre_sucursal} · turno #${t.id_turno}`
    });
};

/** Turno que cerró el sistema a las 00:00 porque nadie lo cerró */
const cajaSinCerrar = async (cliente, id_turno) => {
    const r = await cliente.query(`
        SELECT t.id_turno, t.id_sucursal, t.id_usuario_cajero, u.nombre_completo, s.nombre_sucursal,
               to_char(t.fecha_hora_apertura, 'DD/MM') AS dia
        FROM turno_caja t
        JOIN usuario u ON u.id_usuario = t.id_usuario_cajero
        JOIN sucursal s ON s.id_sucursal = t.id_sucursal
        WHERE t.id_turno = $1`, [id_turno]);
    const t = r.rows[0];
    if (!t) return;
    await crear(cliente, {
        tipo: 'CAJA_SIN_CERRAR', destino: 'USUARIO', id_usuario: t.id_usuario_cajero, id_sucursal: t.id_sucursal,
        ruta: 'cierres-caja', titulo: 'Caja sin cerrar',
        mensaje: `El sistema cerró a las 00:00 la caja del ${t.dia} de ${t.nombre_completo} en ${t.nombre_sucursal}`
    });
};

/** Productos recibidos de otra sucursal */
const transferencia = (cliente, { id_transferencia, origen, destino, id_destino, id_usuario, items }) => crear(cliente, {
    tipo: 'TRANSFERENCIA', destino: 'SUCURSAL', id_sucursal: id_destino, ruta: 'inventario', leida_por: id_usuario,
    titulo:  `Transferencia de ${origen} a ${destino}`,
    mensaje: `#${id_transferencia}: ${items.map(i => `${i.cantidad} ${i.nombre_producto}`).join(', ')}`
});

/** Venta con descuento manual */
const descuentoManual = async (cliente, id_venta) => {
    const r = await cliente.query(`
        SELECT v.id_venta, v.numero_dia, v.descuento_manual, v.motivo_descuento, v.id_sucursal, v.id_usuario_cajero,
               u.nombre_completo, s.nombre_sucursal
        FROM venta_caja v
        JOIN usuario u ON u.id_usuario = v.id_usuario_cajero
        JOIN sucursal s ON s.id_sucursal = v.id_sucursal
        WHERE v.id_venta = $1`, [id_venta]);
    const v = r.rows[0];
    if (!v || !(Number(v.descuento_manual) > 0)) return;
    await crear(cliente, {
        tipo: 'DESCUENTO', id_sucursal: v.id_sucursal, ruta: 'reportes', leida_por: v.id_usuario_cajero,
        titulo:  `Descuento manual de ${await dinero(v.descuento_manual)}`,
        mensaje: `${v.nombre_completo} · ${v.nombre_sucursal} · venta #${v.numero_dia} · Motivo: ${v.motivo_descuento || '-'}`
    });
};

// ─── Consultas del usuario ───

const listar = async (id_usuario, { soloNoLeidas = false } = {}) => {
    const r = await db.query(`
        SELECT ${COLUMNAS}, (nl.id_usuario IS NOT NULL) AS leida, COUNT(*) FILTER (WHERE nl.id_usuario IS NULL) OVER () AS no_leidas
        FROM notificacion n
        JOIN usuario u ON u.id_usuario = $1
        LEFT JOIN notificacion_leida nl ON nl.id_notificacion = n.id_notificacion AND nl.id_usuario = u.id_usuario
        WHERE ${VISIBLE}
        ORDER BY n.fecha_creacion DESC, n.id_notificacion DESC`, [id_usuario]);
    const lista = r.rows.filter(n => !soloNoLeidas || !n.leida).slice(0, MAX_LISTA)
        .map(({ no_leidas, ...n }) => n);
    return { no_leidas: Number(r.rows[0]?.no_leidas || 0), notificaciones: lista };
};

/** ids: las indicadas; sin ids: todas las que ve */
const marcarLeidas = async (id_usuario, ids = null) => {
    const r = await db.query(`
        INSERT INTO notificacion_leida (id_notificacion, id_usuario)
        SELECT n.id_notificacion, u.id_usuario
        FROM notificacion n JOIN usuario u ON u.id_usuario = $1
        WHERE ${VISIBLE} AND ($2::int[] IS NULL OR n.id_notificacion = ANY($2::int[]))
        ON CONFLICT DO NOTHING`, [id_usuario, ids]);
    return r.rowCount;
};

/** Lotes que pasaron a «por vencer» o «vencido»: un aviso por sucursal con los productos y cuántos (cada lote avisa una vez por estado) */
const vencimientos = async () => {
    let avisos = 0;
    for (const g of await loteModel.nuevosVencimientos(db)) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const vencido = g.nivel === 2;
            await crear(client, {
                tipo: vencido ? 'VENCIDO' : 'POR_VENCER', destino: 'SUCURSAL', id_sucursal: g.id_sucursal, ruta: 'inventario',
                titulo:  `${vencido ? 'Vencidos' : 'Por vencer'} en ${g.nombre_sucursal}`,
                mensaje: g.productos.map(p => `${p.nombre} (${p.cantidad})`).join(', ')
            });
            await client.query(`UPDATE lote_inventario SET aviso = GREATEST(aviso, $2) WHERE id_lote = ANY($1::int[])`,
                               [g.lotes, g.nivel]);
            await client.query('COMMIT');
            avisos++;
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('vencimientos:', e.message);
        } finally {
            client.release();
        }
    }
    return avisos;
};

const limpiarAntiguas = async () =>
    (await db.query(`DELETE FROM notificacion WHERE fecha_creacion < CURRENT_TIMESTAMP - make_interval(days => $1)`,
                    [DIAS_GUARDADAS])).rowCount;

module.exports = {
    crear, alCrear, revisarStock, arqueoConDiferencia, cajaSinCerrar, transferencia, descuentoManual,
    listar, marcarLeidas, limpiarAntiguas, vencimientos, DIAS_GUARDADAS
};
