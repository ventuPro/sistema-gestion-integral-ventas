const db = require('../config/db');
const { moverStock } = require('./inventarioModel');

// ─── Reserva del carrito de caja: el stock sale al agregar al carrito (como en Mesas) ───
// Una fila activa (id_venta NULL) por cajero y producto. Al cobrar queda con su venta; al quitar,
// vaciar, cerrar la caja o pasar MINUTOS_RESERVA sin tocar el carrito, el stock vuelve a sus lotes.
const MINUTOS_RESERVA = 30;
const MOTIVO_SALE   = 'Venta en Caja';
const MOTIVO_VUELVE = 'Devuelto del carrito de caja';

const error = (codigo, mensaje, extra = {}) => Object.assign(new Error(mensaje), { code: codigo, ...extra });

/** Turno abierto de hoy del cajero (la reserva es de esa sucursal) */
const turnoAbierto = async (client, id_usuario) => (await client.query(`
    SELECT id_turno, id_sucursal FROM turno_caja
    WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto' AND fecha_hora_apertura >= CURRENT_DATE
    ORDER BY fecha_hora_apertura DESC LIMIT 1 FOR SHARE`, [id_usuario])).rows[0] || null;

/** Devuelve parte (o todo) lo reservado a sus lotes. Devuelve el cambio de stock o null (preparado) */
const devolver = async (client, fila, cantidad, id_usuario) => {
    if (cantidad <= 0) return null;
    const mov = await moverStock(client, {
        id_sucursal: fila.id_sucursal, id_producto: fila.id_producto, cantidad, id_usuario,
        motivo: MOTIVO_VUELVE, detalle: 'Quitado del carrito', devolucion: true, referencia: { id_reserva: fila.id_reserva }
    });
    await client.query(`UPDATE reserva_caja SET cantidad = cantidad - $2, fecha_actualizacion = LOCALTIMESTAMP WHERE id_reserva = $1`,
                       [fila.id_reserva, cantidad]);
    fila.cantidad -= cantidad;
    return mov.stock == null ? null : { id_producto: fila.id_producto, id_sucursal: fila.id_sucursal, nuevo_stock: mov.stock };
};

/**
 * Deja reservadas «cantidad» unidades del producto para el cajero (0 = quitar del carrito).
 * Devuelve { cantidad, stock, cambios }. Errores: CAJA_CERRADA, NO_DISPONIBLE, STOCK_INSUFICIENTE { maximo }.
 */
const fijar = async ({ id_usuario, id_producto, cantidad }) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const turno = await turnoAbierto(client, id_usuario);
        if (!turno) throw error('CAJA_CERRADA', 'La caja está cerrada');

        let fila = (await client.query(`
            SELECT * FROM reserva_caja WHERE id_usuario = $1 AND id_producto = $2 AND id_venta IS NULL FOR UPDATE`,
            [id_usuario, id_producto])).rows[0];
        if (!fila) {
            if (cantidad === 0) { await client.query('COMMIT'); return { cantidad: 0, stock: null, cambios: [] }; }
            fila = (await client.query(`
                INSERT INTO reserva_caja (id_usuario, id_sucursal, id_producto) VALUES ($1, $2, $3) RETURNING *`,
                [id_usuario, turno.id_sucursal, id_producto])).rows[0];
        }

        const cambios = [];
        // Abrió caja en otra sucursal: lo de antes vuelve a la suya
        if (fila.id_sucursal !== turno.id_sucursal) {
            const c = await devolver(client, fila, fila.cantidad, id_usuario);
            if (c) cambios.push(c);
            await client.query(`UPDATE reserva_caja SET id_sucursal = $2 WHERE id_reserva = $1`, [fila.id_reserva, turno.id_sucursal]);
            fila.id_sucursal = turno.id_sucursal;
        }

        const delta = cantidad - fila.cantidad;
        if (delta > 0) {
            const mov = await moverStock(client, {
                id_sucursal: fila.id_sucursal, id_producto, cantidad: -delta, id_usuario,
                motivo: MOTIVO_SALE, detalle: 'En el carrito', referencia: { id_reserva: fila.id_reserva }
            });
            if (mov.existe === false) throw error('NO_DISPONIBLE', 'El producto no está en esta sucursal');
            if (mov.falta) throw error('STOCK_INSUFICIENTE', 'No hay stock suficiente', { maximo: fila.cantidad + mov.disponible });
            await client.query(`UPDATE reserva_caja SET cantidad = $2, fecha_actualizacion = LOCALTIMESTAMP WHERE id_reserva = $1`,
                               [fila.id_reserva, cantidad]);
            if (mov.stock != null) cambios.push({ id_producto, id_sucursal: fila.id_sucursal, nuevo_stock: mov.stock });
        } else if (delta < 0) {
            const c = await devolver(client, fila, -delta, id_usuario);
            if (c) cambios.push(c);
        } else {
            await client.query(`UPDATE reserva_caja SET fecha_actualizacion = LOCALTIMESTAMP WHERE id_reserva = $1`, [fila.id_reserva]);
        }
        await client.query('COMMIT');
        return { cantidad, stock: cambios.at(-1)?.nuevo_stock ?? null, cambios };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/** Lo que el cajero tiene en su carrito (para rearmarlo al volver a la pantalla) */
const activas = async (id_usuario) => (await db.query(`
    SELECT id_producto, cantidad FROM reserva_caja
    WHERE id_usuario = $1 AND id_venta IS NULL AND cantidad > 0 ORDER BY fecha_actualizacion`, [id_usuario])).rows;

/** Para cobrar: las reservas del cajero, bloqueadas, por producto */
const bloquear = async (client, id_usuario) => new Map((await client.query(`
    SELECT * FROM reserva_caja WHERE id_usuario = $1 AND id_venta IS NULL FOR UPDATE`, [id_usuario])).rows
    .map(f => [f.id_producto, f]));

/** Lo reservado que entró en la venta queda con ella */
const vender = (client, fila, id_venta) =>
    client.query(`UPDATE reserva_caja SET id_venta = $2, fecha_actualizacion = LOCALTIMESTAMP WHERE id_reserva = $1`,
                 [fila.id_reserva, id_venta]);

/**
 * Devuelve las reservas olvidadas: sin tocar en MINUTOS_RESERVA o de un cajero que ya no tiene caja abierta.
 * La llama el cierre diario cada minuto. Devuelve los cambios de stock.
 */
const liberarVencidas = async () => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const filas = (await client.query(`
            SELECT r.* FROM reserva_caja r
            WHERE r.id_venta IS NULL AND r.cantidad > 0
              AND (r.fecha_actualizacion < LOCALTIMESTAMP - make_interval(mins => $1)
                   OR NOT EXISTS (SELECT 1 FROM turno_caja t WHERE t.id_usuario_cajero = r.id_usuario AND t.estado_turno = 'Abierto'))
            FOR UPDATE SKIP LOCKED`, [MINUTOS_RESERVA])).rows;
        const cambios = [];
        for (const f of filas) {
            const c = await devolver(client, f, f.cantidad, null);
            if (c) cambios.push(c);
        }
        await client.query('COMMIT');
        return cambios;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = { MINUTOS_RESERVA, MOTIVO_SALE, fijar, activas, bloquear, devolver, vender, liberarVencidas };
