const db = require('../config/db');

// ─── ABRIR CUENTA / COMANDA ───
const abrirCuenta = async (id_mesa, id_usuario) => {
    // Verificar que no haya cuenta abierta en esa mesa
    const existe = await db.query(
        `SELECT id_cuenta FROM cuenta_mesa WHERE id_mesa=$1 AND estado='Abierta'`,
        [id_mesa]
    );
    if (existe.rows.length > 0)
        throw new Error('CUENTA_YA_ABIERTA');

    // Abrir la cuenta
    const r = await db.query(`
        INSERT INTO cuenta_mesa (id_mesa, id_usuario_apertura, estado, total_acumulado)
        VALUES ($1, $2, 'Abierta', 0.00) RETURNING *
    `, [id_mesa, id_usuario]);

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
        SELECT dc.*, p.nombre_producto, p.url_imagen, cat.nombre_categoria
        FROM detalle_cuenta dc
        JOIN producto          p   ON dc.id_producto = p.id_producto
        JOIN categoria_producto cat ON p.id_categoria  = cat.id_categoria
        WHERE dc.id_cuenta=$1
        ORDER BY dc.fecha_agregado ASC
    `, [cuenta.id_cuenta]);

    cuenta.items = rDetalle.rows;
    return cuenta;
};

// ─── AGREGAR PRODUCTO A LA COMANDA ───
const agregarProductoCuenta = async (id_cuenta, id_producto, cantidad, precio_unitario, nota, origen) => {
    const subtotal = cantidad * precio_unitario;

    // Verificar si ya existe el producto en la comanda (mismo origen)
    const existe = await db.query(`
        SELECT id_detalle_cuenta, cantidad, subtotal
        FROM detalle_cuenta
        WHERE id_cuenta=$1 AND id_producto=$2 AND origen=$3
    `, [id_cuenta, id_producto, origen]);

    let detalle;
    if (existe.rows.length > 0) {
        // Incrementar cantidad
        const nuevaCantidad = existe.rows[0].cantidad + cantidad;
        const nuevoSubtotal = nuevaCantidad * precio_unitario;
        detalle = (await db.query(`
            UPDATE detalle_cuenta
            SET cantidad=$1, subtotal=$2
            WHERE id_detalle_cuenta=$3 RETURNING *
        `, [nuevaCantidad, nuevoSubtotal, existe.rows[0].id_detalle_cuenta])).rows[0];
    } else {
        detalle = (await db.query(`
            INSERT INTO detalle_cuenta (id_cuenta,id_producto,cantidad,precio_unitario,subtotal,nota,origen)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [id_cuenta, id_producto, cantidad, precio_unitario, subtotal, nota||null, origen||'cajero'])).rows[0];
    }

    // Actualizar total de la cuenta
    await db.query(`
        UPDATE cuenta_mesa
        SET total_acumulado = (SELECT COALESCE(SUM(subtotal),0) FROM detalle_cuenta WHERE id_cuenta=$1)
        WHERE id_cuenta=$1
    `, [id_cuenta]);

    return detalle;
};

// ─── QUITAR PRODUCTO DE LA COMANDA ───
const quitarProductoCuenta = async (id_detalle_cuenta) => {
    const r = await db.query(
        `DELETE FROM detalle_cuenta WHERE id_detalle_cuenta=$1 RETURNING id_cuenta`,
        [id_detalle_cuenta]
    );
    if (!r.rows.length) throw new Error('DETALLE_NO_ENCONTRADO');

    const id_cuenta = r.rows[0].id_cuenta;
    await db.query(`
        UPDATE cuenta_mesa
        SET total_acumulado = (SELECT COALESCE(SUM(subtotal),0) FROM detalle_cuenta WHERE id_cuenta=$1)
        WHERE id_cuenta=$1
    `, [id_cuenta]);

    return { id_cuenta };
};

// ─── INTEGRAR PEDIDO QR EN LA COMANDA ───
const integrarPedidoQR = async (id_cuenta, id_pedido) => {
    // Traer items del pedido aprobado
    const rItems = await db.query(`
        SELECT dp.id_producto, dp.cantidad_solicitada, dp.precio_aplicado, dp.nota_cliente
        FROM detalle_pedido dp WHERE dp.id_pedido=$1
    `, [id_pedido]);

    for (const item of rItems.rows) {
        await agregarProductoCuenta(
            id_cuenta,
            item.id_producto,
            item.cantidad_solicitada,
            item.precio_aplicado,
            item.nota_cliente,
            'qr'
        );
    }

    return obtenerCuentaActiva(await getCuentaMesaId(id_cuenta));
};

const getCuentaMesaId = async (id_cuenta) => {
    const r = await db.query(`SELECT id_mesa FROM cuenta_mesa WHERE id_cuenta=$1`,[id_cuenta]);
    return r.rows[0]?.id_mesa;
};

// ─── CERRAR CUENTA Y REGISTRAR VENTA ───
const cerrarCuenta = async (id_cuenta, metodo_pago, id_usuario_cajero, id_sucursal) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Obtener cuenta
        const rCuenta = await client.query(
            `SELECT * FROM cuenta_mesa WHERE id_cuenta=$1 AND estado='Abierta'`, [id_cuenta]
        );
        if (!rCuenta.rows.length) throw new Error('CUENTA_NO_ACTIVA');
        const cuenta = rCuenta.rows[0];

        // Obtener turno activo del cajero
        const rTurno = await client.query(
            `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero=$1 AND estado_turno='Abierto' ORDER BY fecha_hora_apertura DESC LIMIT 1`,
            [id_usuario_cajero]
        );
        const id_turno = rTurno.rows[0]?.id_turno || null;

        // Crear registro de venta
        const rVenta = await client.query(`
            INSERT INTO venta_caja (id_sucursal,id_usuario_cajero,id_turno,monto_total_venta,metodo_pago)
            VALUES ($1,$2,$3,$4,$5) RETURNING id_venta
        `, [id_sucursal, id_usuario_cajero, id_turno, cuenta.total_acumulado, metodo_pago]);
        const id_venta = rVenta.rows[0].id_venta;

        // Copiar items de comanda a detalle_venta y descontar inventario
        const rItems = await client.query(
            `SELECT * FROM detalle_cuenta WHERE id_cuenta=$1`, [id_cuenta]
        );
        for (const item of rItems.rows) {
            await client.query(`
                INSERT INTO detalle_venta (id_venta,id_producto,cantidad_vendida,precio_unitario,subtotal_venta)
                VALUES ($1,$2,$3,$4,$5)
            `, [id_venta, item.id_producto, item.cantidad, item.precio_unitario, item.subtotal]);

            await client.query(`
                UPDATE inventario_sucursal
                SET cantidad_actual = cantidad_actual - $1
                WHERE id_sucursal=$2 AND id_producto=$3
            `, [item.cantidad, id_sucursal, item.id_producto]);
        }

        // Cerrar cuenta y liberar mesa
        await client.query(`
            UPDATE cuenta_mesa
            SET estado='Pagada', metodo_pago=$1, fecha_cierre=NOW()
            WHERE id_cuenta=$2
        `, [metodo_pago, id_cuenta]);

        await client.query(
            `UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`,
            [cuenta.id_mesa]
        );

        await client.query('COMMIT');
        return { id_venta, total: cuenta.total_acumulado, id_mesa: cuenta.id_mesa };
    } catch(e) {
        await client.query('ROLLBACK');
        throw e;
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
        LEFT JOIN detalle_cuenta dc ON dc.id_cuenta = c.id_cuenta
        WHERE m.id_sucursal = $1
        GROUP BY m.id_mesa, m.numero_mesa, m.estado_mesa, m.codigo_qr, m.id_sucursal,
                 c.id_cuenta, c.total_acumulado, c.fecha_apertura
        ORDER BY m.numero_mesa ASC
    `, [id_sucursal]);
    return r.rows;
};

module.exports = {
    abrirCuenta, obtenerCuentaActiva, agregarProductoCuenta,
    quitarProductoCuenta, integrarPedidoQR, cerrarCuenta,
    obtenerMesasConCuenta, getCuentaMesaId
};