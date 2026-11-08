const db = require('../config/db');
const notificacionModel = require('./notificacionModel');
const loteModel = require('./loteModel');

// ─── Movimientos de inventario ───
// Todo cambio de stock pasa por moverStock(): bloquea la fila, valida, actualiza el saldo,
// deja la fila en historial_inventario y mueve los lotes (PEPS). Nunca UPDATE directo.

const MOTIVOS = {
    INGRESO: ['Producción', 'Compra a proveedor', 'Devolución de cliente', 'Ajuste de conteo', 'Otro'],
    SALIDA:  ['Vencido', 'Dañado', 'Consumo interno', 'Degustación', 'Ajuste de conteo', 'Otro']
};

const TIPOS_PRODUCTO = ['ELABORADO', 'PREPARADO', 'COMPRADO'];

/** Devuelve el id del historial. referencia: { id_pedido, id_detalle_cuenta } */
const registrarHistorial = async (cliente, { id_inventario, id_usuario, tipo, cantidad, motivo, detalle = null,
                                             stock_resultante, referencia = {} }) => {
    const r = await cliente.query(
        `INSERT INTO historial_inventario
            (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento, detalle, stock_resultante,
             id_pedido, id_detalle_cuenta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_historial`,
        [id_inventario, id_usuario || null, tipo, Math.abs(cantidad), motivo, detalle, stock_resultante,
         referencia.id_pedido || null, referencia.id_detalle_cuenta || null]
    );
    // Toda salida pasa por aquí: aviso de stock bajo o agotado
    if (tipo === 'SALIDA' && stock_resultante != null) {
        const despues = Number(stock_resultante);
        await notificacionModel.revisarStock(cliente, { id_inventario, antes: despues + Math.abs(cantidad), despues });
    }
    return r.rows[0].id_historial;
};

/**
 * Cambia el stock de un producto en una sucursal dentro de la transacción de quien llama.
 * cantidad > 0 entra, < 0 sale. Opciones:
 *   referencia { id_pedido, id_detalle_cuenta }: las devoluciones vuelven a los lotes de esa referencia
 *   devolucion: el ingreso vuelve a sus lotes en vez de crear uno nuevo
 *   desde: lotes que salieron de otra sucursal (transferencia: conservan fecha y vencimiento)
 *   vence: vencimiento del lote nuevo (por defecto, la vida útil del producto)
 *   costo: costo por unidad del lote nuevo (compra); por defecto, el de su receta o la última compra
 *   lotes: ids de lotes de los que debe salir (dar de baja vencidos)
 *   crear: crea la fila de inventario si la sucursal no tenía el producto
 * Devuelve { id_inventario, stock, lotes } o, sin cambiar nada:
 *   { preparado: true } si se hace al momento (no lleva stock), { falta: true, disponible } si no alcanza,
 *   { existe: false } si el producto no está en la sucursal.
 */
const moverStock = async (client, { id_sucursal, id_producto, id_inventario = null, cantidad, id_usuario = null,
                                    motivo, detalle = null, referencia = {}, devolucion = false, desde = null,
                                    vence = null, costo = undefined, lotes = null, crear = false }) => {
    cantidad = Number(cantidad);
    if (!Number.isInteger(cantidad) || cantidad === 0) throw new Error(`Cantidad de stock inválida: ${cantidad}`);
    const buscar = () => client.query(`
        SELECT i.id_inventario, i.cantidad_actual, p.tipo_producto
        FROM inventario_sucursal i JOIN producto p ON p.id_producto = i.id_producto
        WHERE ${id_inventario ? 'i.id_inventario = $1' : 'i.id_sucursal = $1 AND i.id_producto = $2'}
        FOR UPDATE OF i`, id_inventario ? [id_inventario] : [id_sucursal, id_producto]);

    let r = await buscar();
    if (!r.rows.length && crear && !id_inventario) {
        await client.query(`
            INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 0)
            ON CONFLICT (id_sucursal, id_producto) DO NOTHING`, [id_sucursal, id_producto]);
        r = await buscar();
    }
    if (!r.rows.length) return { existe: false, disponible: 0 };

    const inv = r.rows[0];
    if (inv.tipo_producto === 'PREPARADO') return { id_inventario: inv.id_inventario, preparado: true, stock: null };
    const antes = Number(inv.cantidad_actual);
    const stock = antes + cantidad;
    if (stock < 0) return { id_inventario: inv.id_inventario, falta: true, disponible: antes };

    await loteModel.cuadrar(client, inv.id_inventario);
    await client.query(`UPDATE inventario_sucursal SET cantidad_actual = $1 WHERE id_inventario = $2`, [stock, inv.id_inventario]);
    const id_historial = await registrarHistorial(client, {
        id_inventario: inv.id_inventario, id_usuario, tipo: cantidad > 0 ? 'INGRESO' : 'SALIDA',
        cantidad, motivo, detalle, stock_resultante: stock, referencia
    });

    let tomados = [];
    const base = { id_inventario: inv.id_inventario, id_historial, cantidad: Math.abs(cantidad) };
    if (cantidad < 0) {
        const salida = await loteModel.consumir(client, { ...base, lotes });
        if (salida.faltan > 0) throw Object.assign(new Error('Esos lotes ya no tienen esa cantidad'), { codigo: 'LOTE_CAMBIO' });
        tomados = salida.tomados;
    } else if (devolucion) {
        await loteModel.devolver(client, { ...base, referencia });
    } else {
        await loteModel.ingresar(client, { ...base, vence, desde, costo });
    }
    return { id_inventario: inv.id_inventario, stock, lotes: tomados };
};

/** Entrada o merma manual. Lanza { codigo: 'SIN_STOCK' | 'NO_EXISTE' | 'PREPARADO' }. */
const registrarMovimiento = async ({ id_sucursal, id_producto, id_usuario, tipo, cantidad, motivo, detalle, vence = null,
                                     costo = undefined }) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const r = await moverStock(client, {
            id_sucursal, id_producto, id_usuario, cantidad: tipo === 'SALIDA' ? -cantidad : cantidad,
            motivo, detalle, vence: tipo === 'INGRESO' ? vence : null, costo: tipo === 'INGRESO' ? costo : undefined,
            devolucion: false
        });
        if (r.existe === false) throw Object.assign(new Error('El producto no está en esta sucursal'), { codigo: 'NO_EXISTE' });
        if (r.preparado) throw Object.assign(new Error('Este producto se prepara al momento: no lleva stock'), { codigo: 'PREPARADO' });
        if (r.falta) throw Object.assign(new Error(`Solo hay ${r.disponible} en stock: no se pueden dar de baja ${cantidad}`),
                                         { codigo: 'SIN_STOCK' });
        await client.query('COMMIT');
        return { id_inventario: r.id_inventario, cantidad_actual: r.stock };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// ─── Vencidos ───

const listarVencimientos = (id_sucursal) => loteModel.listarVencimientos(db, id_sucursal);

/**
 * «Dar de baja vencidos»: saca de cada lote elegido lo que le queda, como merma «Vencido».
 * Solo lotes de la sucursal que ya vencieron; lo que se vendió mientras tanto ya no se cuenta.
 * Devuelve { lotes, unidades, cambios }.
 */
const darDeBajaVencidos = async ({ id_sucursal, lotes, id_usuario }) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // Filas de inventario en orden fijo (contra bloqueos cruzados) y con sus lotes al día
        const rInv = await client.query(`
            SELECT i.id_inventario FROM inventario_sucursal i
            WHERE i.id_sucursal = $2
              AND i.id_inventario IN (SELECT id_inventario FROM lote_inventario WHERE id_lote = ANY($1::int[]))
            ORDER BY i.id_inventario FOR UPDATE`, [lotes, id_sucursal]);
        for (const { id_inventario } of rInv.rows) await loteModel.cuadrar(client, id_inventario);

        const rLotes = await client.query(`
            SELECT l.id_lote, l.id_inventario, l.cantidad_actual, i.id_producto,
                   to_char(l.fecha_vencimiento, 'DD/MM/YYYY HH24:MI') AS vencio
            FROM lote_inventario l JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
            WHERE l.id_lote = ANY($1::int[]) AND i.id_sucursal = $2
              AND l.cantidad_actual > 0 AND l.fecha_vencimiento <= LOCALTIMESTAMP
            ORDER BY l.id_inventario, l.fecha_ingreso, l.id_lote`, [lotes, id_sucursal]);

        const stock = new Map();
        let unidades = 0;
        for (const l of rLotes.rows) {
            const mov = await moverStock(client, {
                id_inventario: l.id_inventario, cantidad: -l.cantidad_actual, id_usuario, lotes: [l.id_lote],
                motivo: 'Vencido', detalle: `LOTE #${l.id_lote} · VENCIÓ EL ${l.vencio}`
            });
            stock.set(l.id_producto, mov.stock);
            unidades += l.cantidad_actual;
        }
        await client.query('COMMIT');
        return {
            lotes: rLotes.rows.length, unidades,
            cambios: [...stock].map(([id_producto, nuevo_stock]) => ({ id_producto, id_sucursal, nuevo_stock }))
        };
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

// ─── Ingresos del día (lo que se produjo o llegó; sin las devoluciones de pedidos y cuentas) ───
const NO_SON_INGRESOS = ['Devuelto de cuenta de mesa', 'Pedido QR devuelto'];

/** fecha: AAAA-MM-DD o null = hoy (hora de La Paz) */
const ingresosDelDia = async ({ id_sucursal, fecha }) => {
    const r = await db.query(`
        SELECT h.id_historial, h.fecha_registro, h.cantidad_movida, h.motivo_movimiento, h.detalle,
               h.stock_resultante, p.id_producto, p.nombre_producto, u.nombre_completo AS usuario,
               c.id_categoria, c.nombre_categoria, COALESCE(c.orden, 0) AS orden_categoria
        FROM historial_inventario h
        JOIN inventario_sucursal i       ON i.id_inventario = h.id_inventario
        JOIN producto p                  ON p.id_producto   = i.id_producto
        LEFT JOIN categoria_producto c   ON c.id_categoria  = p.id_categoria
        LEFT JOIN usuario u              ON u.id_usuario    = h.id_usuario
        WHERE i.id_sucursal = $1
          AND h.tipo_movimiento = 'INGRESO'
          AND h.motivo_movimiento <> ALL($3)
          AND h.fecha_registro >= COALESCE($2::date, CURRENT_DATE)
          AND h.fecha_registro <  COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
        ORDER BY h.fecha_registro DESC, h.id_historial DESC
    `, [id_sucursal, fecha, NO_SON_INGRESOS]);
    return r.rows;
};

module.exports = { MOTIVOS, TIPOS_PRODUCTO, moverStock, registrarMovimiento, listarMovimientos, ingresosDelDia,
                   listarVencimientos, darDeBajaVencidos };
