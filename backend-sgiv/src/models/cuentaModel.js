const db = require('../config/db');
const { finalizarPedidosDeCuenta } = require('./pedidoModel');
const { registrarHistorial } = require('./inventarioModel');
const promocionModel = require('./promocionModel');

// total_acumulado = lo que falta cobrar (las partes ya pagadas tienen id_venta)
const recalcularTotal = (client, id_cuenta) => client.query(`
    UPDATE cuenta_mesa
    SET total_acumulado = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_cuenta WHERE id_cuenta = $1 AND id_venta IS NULL)
    WHERE id_cuenta = $1
`, [id_cuenta]);

// ─── ABRIR CUENTA / COMANDA ───
const abrirCuenta = async (id_mesa, id_usuario) => {
    // Verificar que no haya cuenta abierta en esa mesa
    const existe = await db.query(
        `SELECT id_cuenta FROM cuenta_mesa WHERE id_mesa=$1 AND estado='Abierta'`,
        [id_mesa]
    );
    if (existe.rows.length > 0)
        throw new Error('CUENTA_YA_ABIERTA');

    // Abrir la cuenta (el índice único uq_cuenta_abierta_mesa evita dos a la vez)
    let r;
    try {
        r = await db.query(`
            INSERT INTO cuenta_mesa (id_mesa, id_usuario_apertura, estado, total_acumulado)
            VALUES ($1, $2, 'Abierta', 0.00) RETURNING *
        `, [id_mesa, id_usuario]);
    } catch (e) {
        if (e.code === '23505') throw new Error('CUENTA_YA_ABIERTA');
        throw e;
    }

    // Cambiar estado de la mesa
    await db.query(
        `UPDATE mesa_local SET estado_mesa='Ocupada' WHERE id_mesa=$1`,
        [id_mesa]
    );

    return r.rows[0];
};

// ─── OBTENER CUENTA ACTIVA DE UNA MESA ───
const obtenerCuentaActiva = async (id_mesa) => {
    const rCuenta = await db.query(`
        SELECT c.*, ml.numero_mesa, s.nombre_sucursal
        FROM cuenta_mesa c
        JOIN mesa_local  ml ON c.id_mesa   = ml.id_mesa
        JOIN sucursal    s  ON ml.id_sucursal = s.id_sucursal
        WHERE c.id_mesa=$1 AND c.estado='Abierta'
        ORDER BY c.fecha_apertura DESC LIMIT 1
    `, [id_mesa]);

    if (!rCuenta.rows.length) return null;
    const cuenta = rCuenta.rows[0];

    // Traer los productos de la comanda
    const rDetalle = await db.query(`
        SELECT dc.*, dc.id_venta IS NOT NULL AS pagado, p.nombre_producto, p.url_imagen, cat.nombre_categoria
        FROM detalle_cuenta dc
        JOIN producto          p   ON dc.id_producto = p.id_producto
        JOIN categoria_producto cat ON p.id_categoria  = cat.id_categoria
        WHERE dc.id_cuenta=$1
        ORDER BY dc.fecha_agregado ASC, dc.id_detalle_cuenta ASC
    `, [cuenta.id_cuenta]);

    cuenta.items = rDetalle.rows;
    return cuenta;
};

// ─── AGREGAR PRODUCTO A LA COMANDA (con reserva inmediata de stock) ───
const agregarProductoCuenta = async (id_cuenta, id_producto, cantidad, precio_unitario, nota, origen, id_usuario = null) => {
    cantidad = Math.floor(Number(cantidad));
    if (!(cantidad > 0)) throw new Error('CANTIDAD_INVALIDA');

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Precio oficial del catálogo (no se confía en el enviado por el cliente)
        const rPrecio = await client.query(
            `SELECT precio_unitario FROM producto WHERE id_producto = $1 AND estado_activo = TRUE`,
            [id_producto]
        );
        if (rPrecio.rows.length === 0) throw new Error('PRODUCTO_SIN_INVENTARIO');
        precio_unitario = Number(rPrecio.rows[0].precio_unitario);

        // 1. Obtener id_sucursal desde la mesa vinculada a la cuenta
        const rSuc = await client.query(`
            SELECT ml.id_sucursal, cm.id_mesa, ml.numero_mesa
            FROM cuenta_mesa cm
            JOIN mesa_local  ml ON cm.id_mesa = ml.id_mesa
            WHERE cm.id_cuenta = $1 AND cm.estado = 'Abierta'
        `, [id_cuenta]);
        if (rSuc.rows.length === 0) throw new Error('CUENTA_NO_ACTIVA');
        const { id_sucursal, id_mesa, numero_mesa } = rSuc.rows[0];

        // 2. Verificar stock disponible en la sucursal (lock de la fila)
        const rStock = await client.query(`
            SELECT id_inventario, cantidad_actual
            FROM inventario_sucursal
            WHERE id_sucursal = $1 AND id_producto = $2
            FOR UPDATE
        `, [id_sucursal, id_producto]);
        if (rStock.rows.length === 0) throw new Error('PRODUCTO_SIN_INVENTARIO');
        const stockActual = Number(rStock.rows[0].cantidad_actual);
        if (stockActual < cantidad) throw new Error('STOCK_INSUFICIENTE');

        // 3. Descontar stock inmediatamente (reserva)
        const rNuevo = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual - $1
            WHERE id_inventario = $2
            RETURNING cantidad_actual
        `, [cantidad, rStock.rows[0].id_inventario]);
        const nuevo_stock = Number(rNuevo.rows[0].cantidad_actual);
        await registrarHistorial(client, {
            id_inventario: rStock.rows[0].id_inventario, id_usuario, tipo: 'SALIDA', cantidad,
            motivo: 'Cuenta de mesa', detalle: `Mesa ${numero_mesa}`, stock_resultante: nuevo_stock
        });

        // 4. Insertar o incrementar en detalle_cuenta
        const subtotal = cantidad * precio_unitario;
        const existe = await client.query(`
            SELECT id_detalle_cuenta, cantidad
            FROM detalle_cuenta
            WHERE id_cuenta=$1 AND id_producto=$2 AND origen=$3 AND id_venta IS NULL AND cliente_mesa IS NULL
        `, [id_cuenta, id_producto, origen]);

        let detalle;
        if (existe.rows.length > 0) {
            const nuevaCantidad = Number(existe.rows[0].cantidad) + cantidad;
            const nuevoSubtotal = nuevaCantidad * precio_unitario;
            detalle = (await client.query(`
                UPDATE detalle_cuenta SET cantidad=$1, subtotal=$2
                WHERE id_detalle_cuenta=$3 RETURNING *
            `, [nuevaCantidad, nuevoSubtotal, existe.rows[0].id_detalle_cuenta])).rows[0];
        } else {
            detalle = (await client.query(`
                INSERT INTO detalle_cuenta (id_cuenta,id_producto,cantidad,precio_unitario,subtotal,nota,origen)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
            `, [id_cuenta, id_producto, cantidad, precio_unitario, subtotal, nota||null, origen||'cajero'])).rows[0];
        }

        // 5. Recalcular total_acumulado de la cuenta
        await recalcularTotal(client, id_cuenta);

        await client.query('COMMIT');
        return { detalle, id_producto, nuevo_stock, id_sucursal, id_mesa };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// ─── QUITAR PRODUCTO DE LA COMANDA (devuelve stock reservado) ───
const quitarProductoCuenta = async (id_detalle_cuenta, id_usuario = null) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener el detalle + id_sucursal
        const rDet = await client.query(`
            SELECT dc.id_cuenta, dc.id_producto, dc.cantidad, dc.id_venta, ml.id_sucursal, cm.id_mesa, ml.numero_mesa
            FROM detalle_cuenta dc
            JOIN cuenta_mesa cm ON dc.id_cuenta = cm.id_cuenta
            JOIN mesa_local  ml ON cm.id_mesa   = ml.id_mesa
            WHERE dc.id_detalle_cuenta = $1 AND cm.estado = 'Abierta'
            FOR UPDATE OF dc
        `, [id_detalle_cuenta]);
        if (rDet.rows.length === 0) throw new Error('DETALLE_NO_ENCONTRADO');
        if (rDet.rows[0].id_venta) throw new Error('DETALLE_PAGADO');
        const { id_cuenta, id_producto, cantidad, id_sucursal, id_mesa, numero_mesa } = rDet.rows[0];

        // 2. Devolver stock al inventario
        const rNuevo = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual + $1
            WHERE id_sucursal=$2 AND id_producto=$3
            RETURNING id_inventario, cantidad_actual
        `, [cantidad, id_sucursal, id_producto]);
        const nuevo_stock = rNuevo.rows.length > 0 ? Number(rNuevo.rows[0].cantidad_actual) : null;
        if (rNuevo.rows.length) {
            await registrarHistorial(client, {
                id_inventario: rNuevo.rows[0].id_inventario, id_usuario, tipo: 'INGRESO', cantidad,
                motivo: 'Devuelto de cuenta de mesa', detalle: `Mesa ${numero_mesa}`, stock_resultante: nuevo_stock
            });
        }

        // 3. Eliminar el detalle
        await client.query(
            `DELETE FROM detalle_cuenta WHERE id_detalle_cuenta=$1`,
            [id_detalle_cuenta]
        );

        // 4. Recalcular total
        await recalcularTotal(client, id_cuenta);

        await client.query('COMMIT');
        return { id_cuenta, id_producto, nuevo_stock, id_sucursal, id_mesa };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// ─── DEVOLVER STOCK DE TODOS LOS ITEMS DE UNA CUENTA (cancelaciones) ───
const devolverStockCuenta = async (client, id_cuenta, id_usuario = null) => {
    const rItems = await client.query(`
        SELECT dc.id_producto, dc.cantidad, ml.id_sucursal, ml.numero_mesa
        FROM detalle_cuenta dc
        JOIN cuenta_mesa cm ON dc.id_cuenta = cm.id_cuenta
        JOIN mesa_local  ml ON cm.id_mesa   = ml.id_mesa
        WHERE dc.id_cuenta = $1 AND dc.id_venta IS NULL
    `, [id_cuenta]);

    const cambios = [];
    for (const item of rItems.rows) {
        const r = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual + $1
            WHERE id_sucursal=$2 AND id_producto=$3
            RETURNING id_inventario, cantidad_actual
        `, [item.cantidad, item.id_sucursal, item.id_producto]);
        if (r.rows.length > 0) {
            await registrarHistorial(client, {
                id_inventario: r.rows[0].id_inventario, id_usuario, tipo: 'INGRESO', cantidad: item.cantidad,
                motivo: 'Devuelto de cuenta de mesa', detalle: `Mesa ${item.numero_mesa} (cuenta cancelada)`,
                stock_resultante: Number(r.rows[0].cantidad_actual)
            });
            cambios.push({
                id_producto:  item.id_producto,
                id_sucursal:  item.id_sucursal,
                nuevo_stock:  Number(r.rows[0].cantidad_actual)
            });
        }
    }
    return cambios;
};

// ─── COBRAR: toda la cuenta o la parte de un cliente ───
// parte = null → todo lo pendiente; { cliente_mesa } → lo pedido desde ese celular
// (cliente_mesa null = lo que cargó el cajero). Si ya no queda nada pendiente se
// cierra la cuenta y se libera la mesa.
// Las promociones vigentes se aplican al cobrar, sobre lo que se paga en este momento.
// descuento: { tipo, valor, motivo } opcional; maxDescuentoPct = null → sin tope (administrador)
const cerrarCuenta = async (id_cuenta, metodo_pago, id_usuario_cajero, parte = null, { descuento = null, maxDescuentoPct = null } = {}) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const rCuenta = await client.query(`
            SELECT c.*, ml.id_sucursal FROM cuenta_mesa c JOIN mesa_local ml ON ml.id_mesa = c.id_mesa
            WHERE c.id_cuenta=$1 AND c.estado='Abierta' FOR UPDATE OF c
        `, [id_cuenta]);
        if (!rCuenta.rows.length) throw new Error('CUENTA_NO_ACTIVA');
        const cuenta = rCuenta.rows[0];

        const rTurno = await client.query(
            `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero=$1 AND estado_turno='Abierto' ORDER BY fecha_hora_apertura DESC LIMIT 1`,
            [id_usuario_cajero]
        );
        if (rTurno.rows.length === 0) throw new Error('CAJA_CERRADA');
        const id_turno = rTurno.rows[0].id_turno;

        const rItems = await client.query(`
            SELECT dc.*, p.id_categoria FROM detalle_cuenta dc
            JOIN producto p ON p.id_producto = dc.id_producto
            WHERE dc.id_cuenta=$1 AND dc.id_venta IS NULL
              AND (NOT $2::boolean OR dc.cliente_mesa IS NOT DISTINCT FROM $3)
            ORDER BY dc.id_detalle_cuenta
        `, [id_cuenta, !!parte, parte?.cliente_mesa ?? null]);
        if (!rItems.rows.length) throw new Error('NADA_POR_COBRAR');

        const cot = await promocionModel.cotizar(client, {
            id_sucursal: cuenta.id_sucursal,
            lineas: rItems.rows.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria, cantidad: Number(i.cantidad),
                                             precioCentavos: Math.round(Number(i.precio_unitario) * 100) })),
            descuento, maxManualPct: maxDescuentoPct
        });
        const total = cot.totalCentavos / 100;

        const rVenta = await client.query(`
            INSERT INTO venta_caja (id_sucursal,id_usuario_cajero,id_turno,monto_total_venta,metodo_pago,
                                    descuento_promociones,descuento_manual,motivo_descuento)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_venta
        `, [cuenta.id_sucursal, id_usuario_cajero, id_turno, total, metodo_pago,
            cot.promoCentavos / 100, cot.manualCentavos / 100, cot.motivo]);
        const id_venta = rVenta.rows[0].id_venta;

        // El stock ya se descontó al agregar cada producto: aquí no se toca
        for (const l of cot.lineas) {
            await client.query(`
                INSERT INTO detalle_venta (id_venta,id_producto,cantidad_vendida,precio_unitario,subtotal_venta,
                                           descuento_promocion,descuento_manual,id_promocion)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            `, [id_venta, l.id_producto, l.cantidad, l.precioCentavos / 100, l.netoCentavos / 100,
                l.descuentoPromoCentavos / 100, l.descuentoManualCentavos / 100, l.id_promocion]);
        }
        await client.query(`UPDATE detalle_cuenta SET id_venta=$1 WHERE id_detalle_cuenta = ANY($2::int[])`,
                           [id_venta, rItems.rows.map(i => i.id_detalle_cuenta)]);

        const rResto = await client.query(
            `SELECT COUNT(*)::int AS n FROM detalle_cuenta WHERE id_cuenta=$1 AND id_venta IS NULL`, [id_cuenta]);
        const cuenta_cerrada = rResto.rows[0].n === 0;

        let pedidos_pagados = [];
        if (cuenta_cerrada) {
            pedidos_pagados = await finalizarPedidosDeCuenta(client, id_cuenta, 'Pagado');
            // Cerrada: total_acumulado guarda todo lo consumido
            await client.query(`
                UPDATE cuenta_mesa
                SET estado='Pagada', metodo_pago=$1, fecha_cierre=NOW(),
                    total_acumulado = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_cuenta WHERE id_cuenta=$2)
                WHERE id_cuenta=$2
            `, [metodo_pago, id_cuenta]);
            await client.query(`UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`, [cuenta.id_mesa]);
        } else {
            await recalcularTotal(client, id_cuenta);
            if (parte?.cliente_mesa) {
                pedidos_pagados = (await client.query(`
                    UPDATE pedido_mesa SET estado_pedido = 'Pagado'
                    WHERE id_cuenta = $1 AND cliente_mesa = $2 AND estado_pedido IN ('Confirmado', 'Entregado')
                    RETURNING id_pedido
                `, [id_cuenta, parte.cliente_mesa])).rows.map(r => r.id_pedido);
            }
        }

        await client.query('COMMIT');
        return { id_venta, total, id_mesa: cuenta.id_mesa, pedidos_pagados, cuenta_cerrada,
                 cotizacion: promocionModel.enBolivianos(cot) };
    } catch(e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// ─── Lo que falta cobrar de una cuenta, con las promociones vigentes (solo lectura) ───
const cotizarCuenta = async (id_cuenta, parte = null) => {
    const client = await db.connect();
    try {
        const rCuenta = await client.query(`
            SELECT ml.id_sucursal FROM cuenta_mesa c JOIN mesa_local ml ON ml.id_mesa = c.id_mesa
            WHERE c.id_cuenta = $1 AND c.estado = 'Abierta'`, [id_cuenta]);
        if (!rCuenta.rows.length) return null;
        const rItems = await client.query(`
            SELECT dc.id_producto, dc.cantidad, dc.precio_unitario, p.id_categoria FROM detalle_cuenta dc
            JOIN producto p ON p.id_producto = dc.id_producto
            WHERE dc.id_cuenta = $1 AND dc.id_venta IS NULL
              AND (NOT $2::boolean OR dc.cliente_mesa IS NOT DISTINCT FROM $3)
            ORDER BY dc.id_detalle_cuenta`, [id_cuenta, !!parte, parte?.cliente_mesa ?? null]);
        const cot = await promocionModel.cotizar(client, {
            id_sucursal: rCuenta.rows[0].id_sucursal,
            lineas: rItems.rows.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria, cantidad: Number(i.cantidad),
                                             precioCentavos: Math.round(Number(i.precio_unitario) * 100) }))
        });
        return promocionModel.enBolivianos(cot);
    } finally {
        client.release();
    }
};

// ─── OBTENER TODAS LAS MESAS CON SU CUENTA ───
const obtenerMesasConCuenta = async (id_sucursal) => {
    const r = await db.query(`
        SELECT
            m.id_mesa,
            m.numero_mesa,
            m.estado_mesa,
            m.codigo_qr,
            m.id_sucursal,
            c.id_cuenta,
            c.total_acumulado,
            c.fecha_apertura,
            COUNT(dc.id_detalle_cuenta)::int AS num_items
        FROM mesa_local m
        LEFT JOIN cuenta_mesa    c  ON c.id_mesa  = m.id_mesa AND c.estado = 'Abierta'
        LEFT JOIN detalle_cuenta dc ON dc.id_cuenta = c.id_cuenta AND dc.id_venta IS NULL
        WHERE m.id_sucursal = $1
        GROUP BY m.id_mesa, m.numero_mesa, m.estado_mesa, m.codigo_qr, m.id_sucursal,
                 c.id_cuenta, c.total_acumulado, c.fecha_apertura
        ORDER BY m.numero_mesa ASC
    `, [id_sucursal]);
    return r.rows;
};

module.exports = {
    abrirCuenta, obtenerCuentaActiva, agregarProductoCuenta,
    quitarProductoCuenta, devolverStockCuenta, cerrarCuenta,
    obtenerMesasConCuenta, cotizarCuenta
};