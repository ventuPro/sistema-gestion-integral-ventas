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

// ─── AGREGAR PRODUCTO A LA COMANDA (con reserva inmediata de stock) ───
const agregarProductoCuenta = async (id_cuenta, id_producto, cantidad, precio_unitario, nota, origen) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener id_sucursal desde la mesa vinculada a la cuenta
        const rSuc = await client.query(`
            SELECT ml.id_sucursal, cm.id_mesa
            FROM cuenta_mesa cm
            JOIN mesa_local  ml ON cm.id_mesa = ml.id_mesa
            WHERE cm.id_cuenta = $1 AND cm.estado = 'Abierta'
        `, [id_cuenta]);
        if (rSuc.rows.length === 0) throw new Error('CUENTA_NO_ACTIVA');
        const { id_sucursal, id_mesa } = rSuc.rows[0];

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

        // 4. Insertar o incrementar en detalle_cuenta
        const subtotal = cantidad * precio_unitario;
        const existe = await client.query(`
            SELECT id_detalle_cuenta, cantidad
            FROM detalle_cuenta
            WHERE id_cuenta=$1 AND id_producto=$2 AND origen=$3
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
        await client.query(`
            UPDATE cuenta_mesa
            SET total_acumulado = (SELECT COALESCE(SUM(subtotal),0) FROM detalle_cuenta WHERE id_cuenta=$1)
            WHERE id_cuenta=$1
        `, [id_cuenta]);

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
const quitarProductoCuenta = async (id_detalle_cuenta) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener el detalle + id_sucursal
        const rDet = await client.query(`
            SELECT dc.id_cuenta, dc.id_producto, dc.cantidad, ml.id_sucursal, cm.id_mesa
            FROM detalle_cuenta dc
            JOIN cuenta_mesa cm ON dc.id_cuenta = cm.id_cuenta
            JOIN mesa_local  ml ON cm.id_mesa   = ml.id_mesa
            WHERE dc.id_detalle_cuenta = $1
        `, [id_detalle_cuenta]);
        if (rDet.rows.length === 0) throw new Error('DETALLE_NO_ENCONTRADO');
        const { id_cuenta, id_producto, cantidad, id_sucursal, id_mesa } = rDet.rows[0];

        // 2. Devolver stock al inventario
        const rNuevo = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual + $1
            WHERE id_sucursal=$2 AND id_producto=$3
            RETURNING cantidad_actual
        `, [cantidad, id_sucursal, id_producto]);
        const nuevo_stock = rNuevo.rows.length > 0 ? Number(rNuevo.rows[0].cantidad_actual) : null;

        // 3. Eliminar el detalle
        await client.query(
            `DELETE FROM detalle_cuenta WHERE id_detalle_cuenta=$1`,
            [id_detalle_cuenta]
        );

        // 4. Recalcular total
        await client.query(`
            UPDATE cuenta_mesa
            SET total_acumulado = (SELECT COALESCE(SUM(subtotal),0) FROM detalle_cuenta WHERE id_cuenta=$1)
            WHERE id_cuenta=$1
        `, [id_cuenta]);

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
const devolverStockCuenta = async (client, id_cuenta) => {
    const rItems = await client.query(`
        SELECT dc.id_producto, dc.cantidad, ml.id_sucursal
        FROM detalle_cuenta dc
        JOIN cuenta_mesa cm ON dc.id_cuenta = cm.id_cuenta
        JOIN mesa_local  ml ON cm.id_mesa   = ml.id_mesa
        WHERE dc.id_cuenta = $1
    `, [id_cuenta]);

    const cambios = [];
    for (const item of rItems.rows) {
        const r = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual + $1
            WHERE id_sucursal=$2 AND id_producto=$3
            RETURNING cantidad_actual
        `, [item.cantidad, item.id_sucursal, item.id_producto]);
        if (r.rows.length > 0) {
            cambios.push({
                id_producto:  item.id_producto,
                id_sucursal:  item.id_sucursal,
                nuevo_stock:  Number(r.rows[0].cantidad_actual)
            });
        }
    }
    return cambios;
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

        const rTurno = await client.query(
            `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero=$1 AND estado_turno='Abierto' ORDER BY fecha_hora_apertura DESC LIMIT 1`,
            [id_usuario_cajero]
        );
        if (rTurno.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('CAJA_CERRADA');
        }
        const id_turno = rTurno.rows[0].id_turno;

        // Crear registro de venta
        const rVenta = await client.query(`
            INSERT INTO venta_caja (id_sucursal,id_usuario_cajero,id_turno,monto_total_venta,metodo_pago)
            VALUES ($1,$2,$3,$4,$5) RETURNING id_venta
        `, [id_sucursal, id_usuario_cajero, id_turno, cuenta.total_acumulado, metodo_pago]);
        const id_venta = rVenta.rows[0].id_venta;

        // Copiar items de comanda a detalle_venta.
        // El stock YA fue descontado al agregar cada producto a la comanda,
        // por lo tanto NO se vuelve a descontar aquí.
        const rItems = await client.query(
            `SELECT * FROM detalle_cuenta WHERE id_cuenta=$1`, [id_cuenta]
        );
        for (const item of rItems.rows) {
            await client.query(`
                INSERT INTO detalle_venta (id_venta,id_producto,cantidad_vendida,precio_unitario,subtotal_venta)
                VALUES ($1,$2,$3,$4,$5)
            `, [id_venta, item.id_producto, item.cantidad, item.precio_unitario, item.subtotal]);
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
    quitarProductoCuenta, devolverStockCuenta, integrarPedidoQR, cerrarCuenta,
    obtenerMesasConCuenta, getCuentaMesaId
};