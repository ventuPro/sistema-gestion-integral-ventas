const db = require('../config/db');

// ─── Movimientos de inventario (entradas y mermas con motivo) ───
// Todo cambio de stock debería dejar una fila en historial_inventario con el
// saldo resultante; registrarHistorial() es el único punto que la escribe.

const MOTIVOS = {
    INGRESO: ['Producción', 'Compra a proveedor', 'Devolución de cliente', 'Ajuste de conteo', 'Otro'],
    SALIDA:  ['Vencido', 'Dañado', 'Consumo interno', 'Degustación', 'Ajuste de conteo', 'Otro']
};

/** cliente: db o un cliente dentro de una transacción */
const registrarHistorial = (cliente, { id_inventario, id_usuario, tipo, cantidad, motivo, detalle = null, stock_resultante }) =>
    cliente.query(
        `INSERT INTO historial_inventario
            (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento, detalle, stock_resultante)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id_inventario, id_usuario || null, tipo, Math.abs(cantidad), motivo, detalle, stock_resultante]
    );

/** Entrada o merma manual. Lanza { codigo: 'SIN_STOCK' } si la salida deja el stock negativo. */
const registrarMovimiento = async ({ id_sucursal, id_producto, id_usuario, tipo, cantidad, motivo, detalle }) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Bloquea la fila: dos movimientos simultáneos no pueden leer el mismo saldo
        const actual = await client.query(
            `SELECT id_inventario, cantidad_actual FROM inventario_sucursal
             WHERE id_sucursal = $1 AND id_producto = $2 FOR UPDATE`,
            [id_sucursal, id_producto]
        );
        if (!actual.rows.length) throw Object.assign(new Error('El producto no está en esta sucursal'), { codigo: 'NO_EXISTE' });

        const { id_inventario, cantidad_actual } = actual.rows[0];
        const nuevo = cantidad_actual + (tipo === 'SALIDA' ? -cantidad : cantidad);
        if (nuevo < 0) {
            throw Object.assign(new Error(`Solo hay ${cantidad_actual} en stock: no se pueden dar de baja ${cantidad}`),
                                { codigo: 'SIN_STOCK' });
        }

        await client.query(`UPDATE inventario_sucursal SET cantidad_actual = $1 WHERE id_inventario = $2`, [nuevo, id_inventario]);
        await registrarHistorial(client, { id_inventario, id_usuario, tipo, cantidad, motivo, detalle, stock_resultante: nuevo });

        await client.query('COMMIT');
        return { id_inventario, cantidad_actual: nuevo };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

/** Historial de una sucursal, del más reciente al más antiguo */
const listarMovimientos = async ({ id_sucursal, id_producto, tipo, desde, hasta, limite = 200 }) => {
    const condiciones = ['i.id_sucursal = $1'];
    const valores = [id_sucursal];
    const agregar = (sql, valor) => { valores.push(valor); condiciones.push(sql.replace('?', `$${valores.length}`)); };

    if (id_producto) agregar('i.id_producto = ?', id_producto);
    if (tipo)        agregar('h.tipo_movimiento = ?', tipo);
    if (desde)       agregar('h.fecha_registro >= ?::date', desde);
    if (hasta)       agregar("h.fecha_registro < ?::date + INTERVAL '1 day'", hasta);
    valores.push(limite);

    const r = await db.query(`
        SELECT h.id_historial, h.fecha_registro, h.tipo_movimiento, h.cantidad_movida,
               h.motivo_movimiento, h.detalle, h.stock_resultante,
               p.id_producto, p.nombre_producto, u.nombre_completo AS usuario
        FROM historial_inventario h
        JOIN inventario_sucursal i ON i.id_inventario = h.id_inventario
        JOIN producto p            ON p.id_producto   = i.id_producto
        LEFT JOIN usuario u        ON u.id_usuario    = h.id_usuario
        WHERE ${condiciones.join(' AND ')}
        ORDER BY h.fecha_registro DESC, h.id_historial DESC
        LIMIT $${valores.length}
    `, valores);
    return r.rows;
};

module.exports = { MOTIVOS, registrarHistorial, registrarMovimiento, listarMovimientos };
