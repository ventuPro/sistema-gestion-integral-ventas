const db = require('../config/db');

// 1. Resumen de Ventas del Día (Ingresos y cantidad de ventas)
const obtenerResumenDiario = async (id_sucursal) => {
    const query = `
        SELECT 
            COUNT(id_venta) AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0) AS ingresos_totales
        FROM venta_caja
        WHERE id_sucursal = $1 AND DATE(fecha_venta) = CURRENT_DATE;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows[0]; // Devuelve un solo objeto con los totales
};

// 2. Top 5 Productos Más Vendidos (Para gráficos)
const obtenerTopProductos = async (id_sucursal) => {
    const query = `
        SELECT 
            p.nombre_producto, 
            SUM(dv.cantidad_vendida) AS total_vendido
        FROM detalle_venta dv
        JOIN venta_caja vc ON dv.id_venta = vc.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
        WHERE vc.id_sucursal = $1
        GROUP BY p.id_producto, p.nombre_producto
        ORDER BY total_vendido DESC
        LIMIT 5;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows; // Devuelve un arreglo con los productos
};

// 3. Alertas de Stock Bajo (Notificaciones para el administrador)
const obtenerAlertasStock = async (id_sucursal) => {
    const query = `
        SELECT 
            p.nombre_producto, 
            i.cantidad_actual, 
            i.stock_minimo_alerta
        FROM inventario_sucursal i
        JOIN producto p ON i.id_producto = p.id_producto
        WHERE i.id_sucursal = $1 AND i.cantidad_actual <= i.stock_minimo_alerta;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows; // Devuelve los productos que necesitan reabastecimiento
};

module.exports = { obtenerResumenDiario, obtenerTopProductos, obtenerAlertasStock };