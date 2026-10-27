const db = require('../config/db');

// ─── Lista de productos que quedaron del día anterior ───
// A las 00:00 se guarda una foto del stock de cada sucursal activa. El cajero puede
// verla hasta la primera venta del día en su sucursal; después solo si el administrador
// la desbloquea. El administrador la ve siempre.

/** Foto del día que terminó para las sucursales que aún no la tienen (una sola consulta) */
const tomarFotos = async () => (await db.query(`
    WITH nuevas AS (
        INSERT INTO foto_stock (id_sucursal, fecha)
        SELECT s.id_sucursal, CURRENT_DATE - 1 FROM sucursal s
        WHERE s.estado_activo
          AND NOT EXISTS (SELECT 1 FROM foto_stock f WHERE f.id_sucursal = s.id_sucursal AND f.fecha = CURRENT_DATE - 1)
        ON CONFLICT DO NOTHING
        RETURNING id_foto, id_sucursal
    ), detalle AS (
        INSERT INTO detalle_foto_stock (id_foto, id_producto, cantidad)
        SELECT n.id_foto, i.id_producto, i.cantidad_actual
        FROM nuevas n
        JOIN inventario_sucursal i ON i.id_sucursal = n.id_sucursal
        JOIN producto p ON p.id_producto = i.id_producto
        WHERE i.cantidad_actual > 0 AND p.estado_activo
        RETURNING id_foto
    )
    SELECT n.id_foto, n.id_sucursal FROM nuevas n
`)).rows;

/**
 * La foto más reciente de la sucursal. Sin acceso (cajero tras la primera venta) no trae productos.
 * null si todavía no hay ninguna.
 */
const obtener = async (id_sucursal, esAdmin) => {
    const r = await db.query(`
        SELECT f.id_foto, f.id_sucursal, s.nombre_sucursal, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.fecha_toma,
               f.fecha_desbloqueo, u.nombre_completo AS desbloqueada_por,
               EXISTS (SELECT 1 FROM venta_caja v WHERE v.id_sucursal = f.id_sucursal
                                                   AND v.fecha_venta >= CURRENT_DATE) AS hubo_ventas
        FROM foto_stock f
        JOIN sucursal s ON s.id_sucursal = f.id_sucursal
        LEFT JOIN usuario u ON u.id_usuario = f.desbloqueada_por
        WHERE f.id_sucursal = $1 AND f.fecha < CURRENT_DATE
        ORDER BY f.fecha DESC
        LIMIT 1
    `, [id_sucursal]);
    const foto = r.rows[0];
    if (!foto) return null;

    // Bloqueada para el cajero: ya hubo ventas hoy y el administrador no la desbloqueó
    foto.bloqueada = foto.hubo_ventas && !foto.fecha_desbloqueo;
    if (foto.bloqueada && !esAdmin) return { ...foto, items: [] };

    const items = await db.query(`
        SELECT d.id_producto, p.nombre_producto, d.cantidad,
               c.id_categoria, c.nombre_categoria, c.orden AS orden_categoria
        FROM detalle_foto_stock d
        JOIN producto p ON p.id_producto = d.id_producto
        JOIN categoria_producto c ON c.id_categoria = p.id_categoria
        WHERE d.id_foto = $1
        ORDER BY c.orden, c.nombre_categoria, p.nombre_producto
    `, [foto.id_foto]);
    return { ...foto, items: items.rows };
};

/** Devuelve el acceso al cajero para esa foto; null si no existe */
const desbloquear = async (id_foto, id_usuario) =>
    (await db.query(`
        UPDATE foto_stock SET desbloqueada_por = $2, fecha_desbloqueo = NOW()
        WHERE id_foto = $1 RETURNING id_foto, id_sucursal
    `, [id_foto, id_usuario])).rows[0] || null;

module.exports = { tomarFotos, obtener, desbloquear };
