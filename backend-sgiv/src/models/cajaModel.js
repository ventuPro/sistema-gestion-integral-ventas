const db = require('../config/db');

const abrirTurno = async (id_sucursal, id_usuario_cajero, monto_inicial) => {
    const query = `
        INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
        VALUES ($1, $2, $3, 'Abierto') RETURNING *;
    `;
    const result = await db.query(query, [id_sucursal, id_usuario_cajero, monto_inicial]);
    return result.rows[0];
};

const cerrarTurno = async (id_turno, monto_real_declarado) => {
    const query = `
        UPDATE turno_caja 
        SET fecha_hora_cierre = CURRENT_TIMESTAMP, monto_real_declarado = $2, estado_turno = 'Cerrado'
        WHERE id_turno = $1 RETURNING *;
    `;
    const result = await db.query(query, [id_turno, monto_real_declarado]);
    return result.rows[0];
};

const registrarVenta = async (datosVenta) => {
    const { id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago, detalles } = datosVenta;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const queryVenta = `
            INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_venta;
        `;
        const resVenta = await client.query(queryVenta, [id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago]);
        const id_venta = resVenta.rows[0].id_venta;
        for (let item of detalles) {
            const queryDetalle = `
                INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                VALUES ($1, $2, $3, $4, $5);
            `;
            await client.query(queryDetalle, [id_venta, item.id_producto, item.cantidad, item.precio, item.subtotal]);
            const queryInventario = `
                UPDATE inventario_sucursal 
                SET cantidad_actual = cantidad_actual - $1 
                WHERE id_sucursal = $2 AND id_producto = $3 RETURNING id_inventario;
            `;
            const resInv = await client.query(queryInventario, [item.cantidad, id_sucursal, item.id_producto]);
            if (resInv.rows.length > 0) {
                const queryHistorial = `
                    INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                    VALUES ($1, $2, 'SALIDA', $3, 'Venta en Caja');
                `;
                await client.query(queryHistorial, [resInv.rows[0].id_inventario, id_usuario_cajero, item.cantidad]);
            }
        }
        if (id_pedido_mesa) {
            await client.query(`UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1`, [id_pedido_mesa]);
            await client.query(`
                UPDATE mesa_local SET estado_mesa = 'Libre' 
                WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)
            `, [id_pedido_mesa]);
        }
        await client.query('COMMIT');
        return id_venta;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// ─── NUEVAS FUNCIONES PARA ARQUEO ──────────────────────────────

const obtenerVentasDetalladas = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            v.id_venta,
            v.fecha_venta,
            v.monto_total_venta,
            v.metodo_pago,
            u.nombre_completo AS cajero,
            json_agg(
                json_build_object(
                    'nombre_producto', p.nombre_producto,
                    'categoria', c.nombre_categoria,
                    'cantidad', dv.cantidad_vendida,
                    'precio_unitario', dv.precio_unitario,
                    'subtotal', dv.subtotal_venta
                ) ORDER BY p.nombre_producto
            ) AS detalles
        FROM venta_caja v
        JOIN usuario u ON v.id_usuario_cajero = u.id_usuario
        JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2
          AND v.fecha_venta <= $3
        GROUP BY v.id_venta, v.fecha_venta, v.monto_total_venta, v.metodo_pago, u.nombre_completo
        ORDER BY v.fecha_venta DESC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

const obtenerResumenPorPeriodo = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            COUNT(v.id_venta)                               AS total_ventas,
            COALESCE(SUM(v.monto_total_venta), 0)           AS ingresos_totales,
            COALESCE(AVG(v.monto_total_venta), 0)           AS ticket_promedio,
            COUNT(DISTINCT DATE(v.fecha_venta))             AS dias_con_ventas,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'Efectivo'  THEN v.monto_total_venta ELSE 0 END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'Tarjeta'   THEN v.monto_total_venta ELSE 0 END), 0) AS total_tarjeta,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'QR'        THEN v.monto_total_venta ELSE 0 END), 0) AS total_qr
        FROM venta_caja v
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2
          AND v.fecha_venta <= $3;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows[0];
};

const obtenerVentasPorCategoria = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            c.nombre_categoria,
            SUM(dv.cantidad_vendida)    AS unidades_vendidas,
            SUM(dv.subtotal_venta)      AS ingresos_categoria
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2
          AND v.fecha_venta <= $3
        GROUP BY c.id_categoria, c.nombre_categoria
        ORDER BY ingresos_categoria DESC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

const obtenerVentasPorDia = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            DATE(v.fecha_venta)         AS fecha,
            COUNT(v.id_venta)           AS total_ventas,
            SUM(v.monto_total_venta)    AS ingresos
        FROM venta_caja v
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2
          AND v.fecha_venta <= $3
        GROUP BY DATE(v.fecha_venta)
        ORDER BY fecha ASC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

module.exports = { abrirTurno, cerrarTurno, registrarVenta, obtenerVentasDetalladas, obtenerResumenPorPeriodo, obtenerVentasPorCategoria, obtenerVentasPorDia };