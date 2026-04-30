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
        SET fecha_hora_cierre = CURRENT_TIMESTAMP,
            monto_real_declarado = $2,
            estado_turno = 'Cerrado'
        WHERE id_turno = $1 RETURNING *;
    `;
    const result = await db.query(query, [id_turno, monto_real_declarado]);
    return result.rows[0];
};

// NUEVO: obtener turno abierto
const obtenerTurnoAbierto = async (id_sucursal) => {
    const query = `
        SELECT t.*, t.monto_inicial::numeric,
               u.nombre_completo AS cajero
        FROM turno_caja t
        JOIN usuario u ON t.id_usuario_cajero = u.id_usuario
        WHERE t.id_sucursal = $1 AND t.estado_turno = 'Abierto'
        ORDER BY t.fecha_hora_apertura DESC LIMIT 1;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows[0] || null;
};

const registrarVenta = async (datosVenta) => {
    const {
        id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa,
        id_turno, monto_total_venta, metodo_pago, detalles
    } = datosVenta;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // FIX: buscar turno abierto si id_turno no existe o es inválido
        let turnoId = id_turno || null;
        if (turnoId) {
            const checkTurno = await client.query(
                `SELECT id_turno FROM turno_caja WHERE id_turno = $1;`, [turnoId]
            );
            if (checkTurno.rows.length === 0) turnoId = null;
        }
        if (!turnoId) {
            const turnoAbierto = await client.query(
                `SELECT id_turno FROM turno_caja
                 WHERE id_sucursal = $1 AND estado_turno = 'Abierto'
                 ORDER BY fecha_hora_apertura DESC LIMIT 1;`,
                [id_sucursal]
            );
            turnoId = turnoAbierto.rows[0]?.id_turno || null;
        }

        const queryVenta = `
            INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_venta;
        `;
        const resVenta = await client.query(queryVenta, [
            id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa,
            turnoId, monto_total_venta, metodo_pago
        ]);
        const id_venta = resVenta.rows[0].id_venta;

        for (const item of detalles) {
            await client.query(
                `INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                 VALUES ($1, $2, $3, $4, $5);`,
                [id_venta, item.id_producto, item.cantidad, item.precio, item.subtotal]
            );
            const resInv = await client.query(
                `UPDATE inventario_sucursal
                 SET cantidad_actual = cantidad_actual - $1
                 WHERE id_sucursal = $2 AND id_producto = $3
                   AND cantidad_actual >= $1
                 RETURNING id_inventario, cantidad_actual;`,
                [item.cantidad, id_sucursal, item.id_producto]
            );
            if (resInv.rows.length === 0) {
                throw new Error(`Stock insuficiente para el producto ID ${item.id_producto}`);
            }
            await client.query(
                `INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                 VALUES ($1, $2, 'SALIDA', $3, 'Venta en Caja');`,
                [resInv.rows[0].id_inventario, id_usuario_cajero, item.cantidad]
            );
        }

        if (id_pedido_mesa) {
            await client.query(
                `UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1`, [id_pedido_mesa]
            );
            await client.query(
                `UPDATE mesa_local SET estado_mesa = 'Libre'
                 WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)`, [id_pedido_mesa]
            );
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

const obtenerVentasDetalladas = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            v.id_venta, v.fecha_venta, v.monto_total_venta::numeric,
            v.metodo_pago, u.nombre_completo AS cajero,
            json_agg(
                json_build_object(
                    'nombre_producto', p.nombre_producto,
                    'categoria',       c.nombre_categoria,
                    'cantidad',        dv.cantidad_vendida,
                    'precio_unitario', dv.precio_unitario,
                    'subtotal',        dv.subtotal_venta
                ) ORDER BY p.nombre_producto
            ) AS detalles
        FROM venta_caja v
        JOIN usuario u ON v.id_usuario_cajero = u.id_usuario
        JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        WHERE v.id_sucursal = $1 AND v.fecha_venta >= $2 AND v.fecha_venta <= $3
        GROUP BY v.id_venta, v.fecha_venta, v.monto_total_venta, v.metodo_pago, u.nombre_completo
        ORDER BY v.fecha_venta DESC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

const obtenerResumenPorPeriodo = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT 
            COUNT(v.id_venta)::int                          AS total_ventas,
            COALESCE(SUM(v.monto_total_venta), 0)::numeric  AS ingresos_totales,
            COALESCE(AVG(v.monto_total_venta), 0)::numeric  AS ticket_promedio,
            COUNT(DISTINCT DATE(v.fecha_venta))::int        AS dias_con_ventas,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'Efectivo' THEN v.monto_total_venta ELSE 0 END), 0)::numeric AS total_efectivo,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'QR'       THEN v.monto_total_venta ELSE 0 END), 0)::numeric AS total_qr
        FROM venta_caja v
        WHERE v.id_sucursal = $1 AND v.fecha_venta >= $2 AND v.fecha_venta <= $3;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows[0];
};

const obtenerVentasPorCategoria = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT c.nombre_categoria,
               SUM(dv.cantidad_vendida)::int     AS unidades_vendidas,
               SUM(dv.subtotal_venta)::numeric   AS ingresos_categoria
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1 AND v.fecha_venta >= $2 AND v.fecha_venta <= $3
        GROUP BY c.id_categoria, c.nombre_categoria
        ORDER BY ingresos_categoria DESC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

const obtenerVentasPorDia = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const query = `
        SELECT DATE(v.fecha_venta)::text AS fecha,
               COUNT(v.id_venta)::int    AS total_ventas,
               SUM(v.monto_total_venta)::numeric AS ingresos
        FROM venta_caja v
        WHERE v.id_sucursal = $1 AND v.fecha_venta >= $2 AND v.fecha_venta <= $3
        GROUP BY DATE(v.fecha_venta)
        ORDER BY fecha ASC;
    `;
    const result = await db.query(query, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows;
};

module.exports = {
    abrirTurno, cerrarTurno, obtenerTurnoAbierto,
    registrarVenta, obtenerVentasDetalladas,
    obtenerResumenPorPeriodo, obtenerVentasPorCategoria, obtenerVentasPorDia
};