const db = require('../config/db');

const obtenerResumenDiario = async (id_sucursal) => {
    const query = `
        SELECT 
            COUNT(id_venta)::int                              AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0)::numeric      AS ingresos_totales,
            COALESCE(SUM(CASE WHEN metodo_pago = 'Efectivo' THEN monto_total_venta ELSE 0 END), 0)::numeric AS total_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago = 'QR'       THEN monto_total_venta ELSE 0 END), 0)::numeric AS total_qr
        FROM venta_caja
        WHERE id_sucursal = $1 AND DATE(fecha_venta) = CURRENT_DATE;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows[0];
};

const obtenerTopProductos = async (id_sucursal) => {
    const query = `
        SELECT p.nombre_producto, SUM(dv.cantidad_vendida)::int AS total_vendido
        FROM detalle_venta dv
        JOIN venta_caja vc ON dv.id_venta = vc.id_venta
        JOIN producto p    ON dv.id_producto = p.id_producto
        WHERE vc.id_sucursal = $1
        GROUP BY p.id_producto, p.nombre_producto
        ORDER BY total_vendido DESC
        LIMIT 5;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows;
};

const obtenerAlertasStock = async (id_sucursal) => {
    const query = `
        SELECT p.nombre_producto, i.cantidad_actual, i.stock_minimo_alerta
        FROM inventario_sucursal i
        JOIN producto p ON i.id_producto = p.id_producto
        WHERE i.id_sucursal = $1 AND i.cantidad_actual <= i.stock_minimo_alerta;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows;
};

// Dashboard completo para resumen
const obtenerDashboardCompleto = async (id_sucursal, id_categoria = null) => {
    const queryResumen = `
        SELECT 
            COUNT(id_venta)::int                              AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0)::numeric      AS ingresos_totales,
            COALESCE(SUM(CASE WHEN metodo_pago = 'Efectivo' THEN monto_total_venta ELSE 0 END), 0)::numeric AS total_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago = 'QR'       THEN monto_total_venta ELSE 0 END), 0)::numeric AS total_qr
        FROM venta_caja
        WHERE id_sucursal = $1 AND DATE(fecha_venta) = CURRENT_DATE;
    `;
    const queryTurno = `
        SELECT t.id_turno, t.estado_turno, t.monto_inicial::numeric, t.fecha_hora_apertura,
               u.nombre_completo AS cajero
        FROM turno_caja t
        JOIN usuario u ON t.id_usuario_cajero = u.id_usuario
        WHERE t.id_sucursal = $1 AND t.estado_turno = 'Abierto'
        ORDER BY t.fecha_hora_apertura DESC LIMIT 1;
    `;
    const queryVentasDia = `
        SELECT DATE(fecha_venta)::text AS fecha,
               SUM(monto_total_venta)::numeric AS ingresos,
               COUNT(*)::int                   AS ventas
        FROM venta_caja
        WHERE id_sucursal = $1 AND fecha_venta >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(fecha_venta)
        ORDER BY fecha ASC;
    `;
    const queryMetodos = `
        SELECT metodo_pago,
               COUNT(*)::int                AS cantidad,
               SUM(monto_total_venta)::numeric AS total
        FROM venta_caja
        WHERE id_sucursal = $1 AND DATE(fecha_venta) = CURRENT_DATE
        GROUP BY metodo_pago;
    `;

    let queryProductos, paramsProductos;
    if (id_categoria) {
        queryProductos = `
            SELECT p.nombre_producto, c.nombre_categoria, SUM(dv.cantidad_vendida)::int AS total_vendido
            FROM detalle_venta dv
            JOIN producto p ON dv.id_producto = p.id_producto
            JOIN categoria_producto c ON p.id_categoria = c.id_categoria
            JOIN venta_caja vc ON dv.id_venta = vc.id_venta
            WHERE vc.id_sucursal = $1 AND DATE(vc.fecha_venta) = CURRENT_DATE AND p.id_categoria = $2
            GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
            ORDER BY total_vendido DESC LIMIT 8;
        `;
        paramsProductos = [id_sucursal, id_categoria];
    } else {
        queryProductos = `
            SELECT p.nombre_producto, c.nombre_categoria, SUM(dv.cantidad_vendida)::int AS total_vendido
            FROM detalle_venta dv
            JOIN producto p ON dv.id_producto = p.id_producto
            JOIN categoria_producto c ON p.id_categoria = c.id_categoria
            JOIN venta_caja vc ON dv.id_venta = vc.id_venta
            WHERE vc.id_sucursal = $1 AND DATE(vc.fecha_venta) = CURRENT_DATE
            GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
            ORDER BY total_vendido DESC LIMIT 8;
        `;
        paramsProductos = [id_sucursal];
    }

    const [resumen, turno, ventasDia, metodos, productos] = await Promise.all([
        db.query(queryResumen,    [id_sucursal]),
        db.query(queryTurno,      [id_sucursal]),
        db.query(queryVentasDia,  [id_sucursal]),
        db.query(queryMetodos,    [id_sucursal]),
        db.query(queryProductos,  paramsProductos)
    ]);

    return {
        resumen_hoy:   resumen.rows[0],
        turno_actual:  turno.rows[0] || null,
        ventas_por_dia: ventasDia.rows,
        metodos_pago:  metodos.rows,
        top_productos: productos.rows
    };
};

const obtenerReportePorPeriodo = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const queryResumen = `
        SELECT
            COUNT(id_venta)::int AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0)::numeric AS ingresos_totales,
            COALESCE(AVG(monto_total_venta), 0)::numeric AS ticket_promedio
        FROM venta_caja
        WHERE id_sucursal = $1
          AND fecha_venta >= $2::date
          AND fecha_venta <  ($3::date + INTERVAL '1 day');
    `;
    const queryVentasDiarias = `
        SELECT DATE(fecha_venta)::text AS dia,
               COUNT(*)::int           AS ventas,
               SUM(monto_total_venta)::numeric AS ingresos
        FROM venta_caja
        WHERE id_sucursal = $1
          AND fecha_venta >= $2::date
          AND fecha_venta <  ($3::date + INTERVAL '1 day')
        GROUP BY DATE(fecha_venta)
        ORDER BY dia ASC;
    `;
    const queryCategorias = `
        SELECT c.nombre_categoria,
               SUM(dv.subtotal_venta)::numeric  AS ingresos,
               SUM(dv.cantidad_vendida)::int     AS unidades
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2::date
          AND v.fecha_venta <  ($3::date + INTERVAL '1 day')
        GROUP BY c.id_categoria, c.nombre_categoria
        ORDER BY ingresos DESC;
    `;
    const queryTopProductos = `
        SELECT p.nombre_producto, c.nombre_categoria,
               SUM(dv.cantidad_vendida)::int     AS unidades,
               SUM(dv.subtotal_venta)::numeric   AS ingresos
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2::date
          AND v.fecha_venta <  ($3::date + INTERVAL '1 day')
        GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
        ORDER BY ingresos DESC
        LIMIT 10;
    `;

    const [resumen, ventasDiarias, categorias, topProductos] = await Promise.all([
        db.query(queryResumen,      [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryVentasDiarias, [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryCategorias,   [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryTopProductos, [id_sucursal, fecha_inicio, fecha_fin])
    ]);

    return {
        resumen:         resumen.rows[0],
        ventas_diarias:  ventasDiarias.rows,
        por_categoria:   categorias.rows,
        top_productos:   topProductos.rows
    };
};

module.exports = {
    obtenerResumenDiario,
    obtenerTopProductos,
    obtenerAlertasStock,
    obtenerDashboardCompleto,
    obtenerReportePorPeriodo
};