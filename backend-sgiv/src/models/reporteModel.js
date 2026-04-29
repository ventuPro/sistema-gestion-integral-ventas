const db = require('../config/db');

const obtenerResumenDiario = async (id_sucursal) => {
    const query = `
        SELECT 
            COUNT(id_venta) AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0) AS ingresos_totales
        FROM venta_caja
        WHERE id_sucursal = $1
          AND DATE(fecha_venta) = CURRENT_DATE;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows[0];
};

const obtenerTopProductos = async (id_sucursal) => {
    const query = `
        SELECT p.nombre_producto, SUM(dv.cantidad_vendida) AS total_vendido
        FROM detalle_venta dv
        JOIN venta_caja vc ON dv.id_venta = vc.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
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

// NUEVO: Reporte completo con filtro de fechas
const obtenerReportePorPeriodo = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const queryResumen = `
        SELECT 
            COUNT(id_venta) AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0) AS ingresos_totales,
            COALESCE(AVG(monto_total_venta), 0) AS ticket_promedio
        FROM venta_caja
        WHERE id_sucursal = $1 AND fecha_venta BETWEEN $2 AND $3;
    `;
    const queryVentasDiarias = `
        SELECT DATE(fecha_venta) AS dia, COUNT(*) AS ventas, SUM(monto_total_venta) AS ingresos
        FROM venta_caja
        WHERE id_sucursal = $1 AND fecha_venta BETWEEN $2 AND $3
        GROUP BY DATE(fecha_venta)
        ORDER BY dia ASC;
    `;
    const queryCategorias = `
        SELECT c.nombre_categoria, SUM(dv.subtotal_venta) AS ingresos, SUM(dv.cantidad_vendida) AS unidades
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1 AND v.fecha_venta BETWEEN $2 AND $3
        GROUP BY c.id_categoria, c.nombre_categoria
        ORDER BY ingresos DESC;
    `;
    const queryTopProductos = `
        SELECT p.nombre_producto, c.nombre_categoria,
               SUM(dv.cantidad_vendida) AS unidades, SUM(dv.subtotal_venta) AS ingresos
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        JOIN venta_caja v ON dv.id_venta = v.id_venta
        WHERE v.id_sucursal = $1 AND v.fecha_venta BETWEEN $2 AND $3
        GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
        ORDER BY ingresos DESC
        LIMIT 10;
    `;

    const [resumen, ventasDiarias, categorias, topProductos] = await Promise.all([
        db.query(queryResumen, [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryVentasDiarias, [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryCategorias, [id_sucursal, fecha_inicio, fecha_fin]),
        db.query(queryTopProductos, [id_sucursal, fecha_inicio, fecha_fin])
    ]);

    return {
        resumen: resumen.rows[0],
        ventas_diarias: ventasDiarias.rows,
        por_categoria: categorias.rows,
        top_productos: topProductos.rows
    };
};

module.exports = { obtenerResumenDiario, obtenerTopProductos, obtenerAlertasStock, obtenerReportePorPeriodo };