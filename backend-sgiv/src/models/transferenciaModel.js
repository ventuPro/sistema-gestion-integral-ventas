const db = require('../config/db');
const { moverStock } = require('./inventarioModel');
const notificacionModel = require('./notificacionModel');
const { revisar } = require('../utils/validacion');

// ─── Transferencias directas entre sucursales ───
// El stock sale del origen y entra al destino en la misma transacción.
// No se editan ni se borran: un error se corrige con otra transferencia de vuelta.

const MAX_PRODUCTOS = 50;
const MAX_CANTIDAD  = 100000;
const MAX_OBSERVACION = 200;

const error = (codigo, message) => Object.assign(new Error(message), { codigo });

/** Junta productos repetidos y ordena por id (orden fijo: evita bloqueos cruzados) */
const normalizarItems = (items) => {
    if (!Array.isArray(items) || !items.length) throw error('INVALIDA', 'Agrega al menos un producto');
    const porProducto = new Map();
    for (const it of items) {
        const id_producto = Number(it?.id_producto), cantidad = Number(it?.cantidad);
        if (!Number.isInteger(id_producto) || id_producto <= 0 || !Number.isInteger(cantidad) || cantidad <= 0)
            throw error('INVALIDA', 'Producto o cantidad inválidos');
        porProducto.set(id_producto, (porProducto.get(id_producto) || 0) + cantidad);
    }
    if (porProducto.size > MAX_PRODUCTOS) throw error('INVALIDA', `Máximo ${MAX_PRODUCTOS} productos por transferencia`);
    const lista = [...porProducto].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));
    if (lista.some(i => i.cantidad > MAX_CANTIDAD)) throw error('INVALIDA', `Máximo ${MAX_CANTIDAD} unidades por producto`);
    return lista.sort((a, b) => a.id_producto - b.id_producto);
};

const crear = async ({ id_origen, id_destino, id_usuario, items, observacion }) => {
    const lista = normalizarItems(items);
    let nota;
    try { nota = revisar(observacion, 'texto', { etiqueta: 'La observación', max: MAX_OBSERVACION })?.toLocaleUpperCase('es') ?? null; }
    catch (e) { throw error('INVALIDA', e.message); }
    if (!Number.isInteger(id_origen) || !Number.isInteger(id_destino)) throw error('INVALIDA', 'Sucursal inválida');
    if (id_origen === id_destino) throw error('INVALIDA', 'El origen y el destino deben ser sucursales distintas');

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const rSuc = await client.query(
            `SELECT id_sucursal, nombre_sucursal, estado_activo FROM sucursal WHERE id_sucursal = ANY($1::int[])`,
            [[id_origen, id_destino]]);
        const origen  = rSuc.rows.find(s => s.id_sucursal === id_origen);
        const destino = rSuc.rows.find(s => s.id_sucursal === id_destino);
        if (!origen || !destino) throw error('NO_EXISTE', 'Sucursal no encontrada');
        if (!destino.estado_activo) throw error('INVALIDA', `La sucursal ${destino.nombre_sucursal} está inactiva`);

        const rProd = await client.query(
            `SELECT id_producto, nombre_producto FROM producto WHERE id_producto = ANY($1::int[]) AND estado_activo = TRUE`,
            [lista.map(i => i.id_producto)]);
        const nombres = new Map(rProd.rows.map(p => [p.id_producto, p.nombre_producto]));
        if (lista.some(i => !nombres.has(i.id_producto))) throw error('INVALIDA', 'Un producto ya no está disponible');

        const rTr = await client.query(`
            INSERT INTO transferencia (id_sucursal_origen, id_sucursal_destino, id_usuario, observacion)
            VALUES ($1, $2, $3, $4) RETURNING *
        `, [id_origen, id_destino, id_usuario, nota]);
        const tr = rTr.rows[0];

        const cambios = [];
        for (const it of lista) {
            const nombre = nombres.get(it.id_producto);
            // Las dos filas en orden fijo: dos transferencias opuestas a la vez no se traban
            await client.query(`
                SELECT 1 FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = ANY($2::int[])
                ORDER BY id_inventario FOR UPDATE`, [it.id_producto, [id_origen, id_destino]]);
            const sale = await moverStock(client, {
                id_sucursal: id_origen, id_producto: it.id_producto, cantidad: -it.cantidad, id_usuario,
                motivo: 'Transferencia', detalle: `A ${destino.nombre_sucursal} · #${tr.id_transferencia}`
            });
            if (sale.preparado) throw error('INVALIDA', `"${nombre}" se prepara al momento: no se transfiere`);
            if (sale.falta || sale.existe === false)
                throw error('SIN_STOCK', `Solo quedan ${sale.disponible ?? 0} de "${nombre}" en ${origen.nombre_sucursal}`);

            // Entra con los mismos lotes (fecha y vencimiento); si el destino nunca tuvo el producto, se le crea
            const entra = await moverStock(client, {
                id_sucursal: id_destino, id_producto: it.id_producto, cantidad: it.cantidad, id_usuario, crear: true,
                motivo: 'Transferencia', detalle: `Desde ${origen.nombre_sucursal} · #${tr.id_transferencia}`,
                desde: sale.lotes
            });

            await client.query(
                `INSERT INTO detalle_transferencia (id_transferencia, id_producto, cantidad) VALUES ($1, $2, $3)`,
                [tr.id_transferencia, it.id_producto, it.cantidad]);
            cambios.push({ id_producto: it.id_producto, id_sucursal: id_origen,  nuevo_stock: sale.stock },
                         { id_producto: it.id_producto, id_sucursal: id_destino, nuevo_stock: entra.stock });
        }
        await notificacionModel.transferencia(client, {
            id_transferencia: tr.id_transferencia, origen: origen.nombre_sucursal, destino: destino.nombre_sucursal,
            id_destino, id_usuario, items: lista.map(i => ({ ...i, nombre_producto: nombres.get(i.id_producto) }))
        });

        await client.query('COMMIT');
        return {
            transferencia: { ...tr, nombre_origen: origen.nombre_sucursal, nombre_destino: destino.nombre_sucursal },
            items: lista.map(i => ({ ...i, nombre_producto: nombres.get(i.id_producto) })),
            cambios
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// id_sucursal null = todas (administrador); si no, las que salieron o llegaron a esa sucursal
const listar = async ({ id_sucursal = null, desde = null, hasta = null, limite = 200 }) => {
    const r = await db.query(`
        SELECT t.id_transferencia, t.fecha_transferencia, t.observacion,
               t.id_sucursal_origen, so.nombre_sucursal AS nombre_origen,
               t.id_sucursal_destino, sd.nombre_sucursal AS nombre_destino,
               u.nombre_completo AS usuario,
               COUNT(d.id_producto)::int AS productos, COALESCE(SUM(d.cantidad), 0)::int AS unidades
        FROM transferencia t
        JOIN sucursal so ON so.id_sucursal = t.id_sucursal_origen
        JOIN sucursal sd ON sd.id_sucursal = t.id_sucursal_destino
        LEFT JOIN usuario u ON u.id_usuario = t.id_usuario
        LEFT JOIN detalle_transferencia d ON d.id_transferencia = t.id_transferencia
        WHERE ($1::int IS NULL OR t.id_sucursal_origen = $1 OR t.id_sucursal_destino = $1)
          AND ($2::date IS NULL OR t.fecha_transferencia >= $2::date)
          AND ($3::date IS NULL OR t.fecha_transferencia < $3::date + INTERVAL '1 day')
        GROUP BY t.id_transferencia, so.nombre_sucursal, sd.nombre_sucursal, u.nombre_completo
        ORDER BY t.fecha_transferencia DESC, t.id_transferencia DESC
        LIMIT $4
    `, [id_sucursal, desde, hasta, limite]);
    return r.rows;
};

/** Con sus productos (para el detalle y el comprobante); null si no existe o no es de la sucursal */
const obtener = async (id_transferencia, id_sucursal = null) => {
    const r = await db.query(`
        SELECT t.id_transferencia, t.fecha_transferencia, t.observacion,
               t.id_sucursal_origen, so.nombre_sucursal AS nombre_origen,
               t.id_sucursal_destino, sd.nombre_sucursal AS nombre_destino,
               u.nombre_completo AS usuario,
               json_agg(json_build_object('id_producto', p.id_producto, 'nombre_producto', p.nombre_producto,
                                          'cantidad', d.cantidad) ORDER BY p.nombre_producto) AS items
        FROM transferencia t
        JOIN sucursal so ON so.id_sucursal = t.id_sucursal_origen
        JOIN sucursal sd ON sd.id_sucursal = t.id_sucursal_destino
        LEFT JOIN usuario u ON u.id_usuario = t.id_usuario
        JOIN detalle_transferencia d ON d.id_transferencia = t.id_transferencia
        JOIN producto p ON p.id_producto = d.id_producto
        WHERE t.id_transferencia = $1
          AND ($2::int IS NULL OR t.id_sucursal_origen = $2 OR t.id_sucursal_destino = $2)
        GROUP BY t.id_transferencia, so.nombre_sucursal, sd.nombre_sucursal, u.nombre_completo
    `, [id_transferencia, id_sucursal]);
    return r.rows[0] || null;
};

module.exports = { crear, listar, obtener };
