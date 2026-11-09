const db = require('../config/db');
const { METODO_PAGO } = require('../utils/metodosPago');
const promocionModel = require('./promocionModel');
const { CONDICION_VIGENTE } = promocionModel;
const { AVISO } = require('./loteModel');

// id_sucursal = 0 → todas las sucursales (solo administrador, lo controla el controlador)
const deSucursal = (columna) => `($1::int = 0 OR ${columna} = $1)`;

const filas = (sql, params) => db.query(sql, params).then(r => r.rows);

// ─── Panel del día ───
// esAdmin: trae las sucursales con caja abierta (selector) y la ganancia del día
const obtenerPanel = async (id_sucursal, id_categoria = null, esAdmin = false) => {
    const p = [id_sucursal];

    const totales = (desde, hasta) => filas(`
        SELECT COUNT(*)::int AS ventas,
               ROUND(COALESCE(SUM(monto_total_venta), 0), 2)::float8 AS ingresos
        FROM venta_caja
        WHERE ${deSucursal('id_sucursal')} AND fecha_venta >= ${desde} AND fecha_venta < ${hasta}
    `, p).then(r => r[0]);

    const [
        hoy, ayerHora, ayerTotal, semanaHora, metodos, porHora, promedioHora,
        productos, turnos, mesas, pedidos, stock, stockCritico, ultimas, sucursales, cajas, promociones,
        costoHoy, categoriasHoy, vencimientos, porVencer, descuentosHoy
    ] = await Promise.all([
        filas(`
            SELECT COUNT(*)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto_total_venta), 0), 2)::float8 AS ingresos,
                   ROUND(COALESCE(AVG(v.monto_total_venta), 0), 2)::float8 AS ticket,
                   ROUND(COALESCE(MAX(v.monto_total_venta), 0), 2)::float8 AS venta_maxima,
                   COALESCE((SELECT SUM(dv.cantidad_vendida) FROM detalle_venta dv
                             JOIN venta_caja v2 ON v2.id_venta = dv.id_venta
                             WHERE ${deSucursal('v2.id_sucursal')} AND v2.fecha_venta >= CURRENT_DATE), 0)::int AS unidades,
                   MIN(v.fecha_venta) AS primera_venta
            FROM venta_caja v
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
        `, p).then(r => r[0]),
        totales(`CURRENT_DATE - 1`, `LOCALTIMESTAMP - INTERVAL '1 day'`),
        totales(`CURRENT_DATE - 1`, `CURRENT_DATE`),
        totales(`CURRENT_DATE - 7`, `LOCALTIMESTAMP - INTERVAL '7 days'`),
        filas(`
            SELECT metodo_pago, COUNT(*)::int AS ventas,
                   ROUND(SUM(monto_total_venta), 2)::float8 AS ingresos
            FROM venta_caja
            WHERE ${deSucursal('id_sucursal')} AND fecha_venta >= CURRENT_DATE
            GROUP BY metodo_pago ORDER BY ingresos DESC
        `, p),
        filas(`
            SELECT EXTRACT(HOUR FROM fecha_venta)::int AS hora, COUNT(*)::int AS ventas,
                   ROUND(SUM(monto_total_venta), 2)::float8 AS ingresos
            FROM venta_caja
            WHERE ${deSucursal('id_sucursal')} AND fecha_venta >= CURRENT_DATE
            GROUP BY 1 ORDER BY 1
        `, p),
        filas(`
            SELECT EXTRACT(HOUR FROM fecha_venta)::int AS hora,
                   ROUND(SUM(monto_total_venta) / 7, 2)::float8 AS ingresos,
                   ROUND(COUNT(*) / 7.0, 1)::float8 AS ventas
            FROM venta_caja
            WHERE ${deSucursal('id_sucursal')} AND fecha_venta >= CURRENT_DATE - 7 AND fecha_venta < CURRENT_DATE
            GROUP BY 1 ORDER BY 1
        `, p),
        filas(`
            SELECT p.nombre_producto, c.nombre_categoria,
                   SUM(dv.cantidad_vendida)::int AS unidades,
                   ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos
            FROM detalle_venta dv
            JOIN venta_caja v         ON v.id_venta = dv.id_venta
            JOIN producto p           ON p.id_producto = dv.id_producto
            JOIN categoria_producto c ON c.id_categoria = p.id_categoria
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
              AND ($2::int IS NULL OR p.id_categoria = $2)
            GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
            ORDER BY unidades DESC, ingresos DESC
            LIMIT 8
        `, [id_sucursal, id_categoria]),
        filas(`
            SELECT t.id_turno, s.nombre_sucursal, u.nombre_completo AS cajero,
                   t.fecha_hora_apertura, t.monto_inicial::float8 AS monto_inicial,
                   COUNT(v.id_venta)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto_total_venta), 0), 2)::float8 AS total,
                   ROUND(COALESCE(SUM(v.monto_total_venta) FILTER (WHERE v.metodo_pago = '${METODO_PAGO.efectivo}'), 0), 2)::float8 AS efectivo
            FROM turno_caja t
            JOIN usuario u  ON u.id_usuario = t.id_usuario_cajero
            JOIN sucursal s ON s.id_sucursal = t.id_sucursal
            LEFT JOIN venta_caja v ON v.id_turno = t.id_turno
            WHERE t.estado_turno = 'Abierto' AND ${deSucursal('t.id_sucursal')}
            GROUP BY t.id_turno, s.nombre_sucursal, u.nombre_completo
            ORDER BY t.fecha_hora_apertura
        `, p),
        filas(`
            SELECT COUNT(*)::int AS total, COUNT(c.id_cuenta)::int AS ocupadas,
                   ROUND(COALESCE(SUM((SELECT SUM(dc.subtotal) FROM detalle_cuenta dc WHERE dc.id_cuenta = c.id_cuenta AND dc.id_venta IS NULL)), 0), 2)::float8 AS por_cobrar
            FROM mesa_local m
            LEFT JOIN cuenta_mesa c ON c.id_mesa = m.id_mesa AND c.estado = 'Abierta'
            WHERE ${deSucursal('m.id_sucursal')}
        `, p).then(r => r[0]),
        filas(`
            SELECT COUNT(*) FILTER (WHERE pm.estado_pedido = 'Pendiente_Cajero')::int AS pendientes,
                   COUNT(*) FILTER (WHERE pm.estado_pedido = 'Confirmado')::int       AS por_entregar,
                   COUNT(*) FILTER (WHERE pm.fecha_pedido >= CURRENT_DATE)::int       AS hoy
            FROM pedido_mesa pm
            LEFT JOIN mesa_local m ON m.id_mesa = pm.id_mesa
            WHERE ${deSucursal('COALESCE(pm.id_sucursal, m.id_sucursal)')}
        `, p).then(r => r[0]),
        filas(`
            SELECT COUNT(*)::int AS productos,
                   COUNT(*) FILTER (WHERE i.cantidad_actual <= 0)::int AS agotados,
                   COUNT(*) FILTER (WHERE i.cantidad_actual > 0 AND i.cantidad_actual <= (SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1))::int AS bajos
            FROM inventario_sucursal i
            JOIN producto p ON p.id_producto = i.id_producto AND p.estado_activo AND p.tipo_producto <> 'PREPARADO'
            WHERE ${deSucursal('i.id_sucursal')}
        `, p).then(r => r[0]),
        filas(`
            SELECT p.nombre_producto, s.nombre_sucursal, i.cantidad_actual, (SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1) AS stock_minimo_alerta
            FROM inventario_sucursal i
            JOIN producto p ON p.id_producto = i.id_producto AND p.estado_activo AND p.tipo_producto <> 'PREPARADO'
            JOIN sucursal s ON s.id_sucursal = i.id_sucursal
            WHERE ${deSucursal('i.id_sucursal')} AND i.cantidad_actual <= (SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1)
            ORDER BY (i.cantidad_actual > 0), i.cantidad_actual::numeric / GREATEST((SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1), 1)
            LIMIT 8
        `, p),
        filas(`
            SELECT v.id_venta, v.numero_dia, v.fecha_venta, v.metodo_pago, s.nombre_sucursal,
                   v.monto_total_venta::float8 AS monto, u.nombre_completo AS cajero,
                   (SELECT COALESCE(SUM(cantidad_vendida), 0) FROM detalle_venta WHERE id_venta = v.id_venta)::int AS unidades
            FROM venta_caja v
            JOIN sucursal s     ON s.id_sucursal = v.id_sucursal
            LEFT JOIN usuario u ON u.id_usuario = v.id_usuario_cajero
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
            ORDER BY v.fecha_venta DESC
            LIMIT 8
        `, p),
        id_sucursal !== 0 ? [] : filas(`
            SELECT s.id_sucursal, s.nombre_sucursal, s.estado_activo,
                   COUNT(v.id_venta)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto_total_venta), 0), 2)::float8 AS ingresos,
                   EXISTS (SELECT 1 FROM turno_caja t
                           WHERE t.id_sucursal = s.id_sucursal AND t.estado_turno = 'Abierto') AS caja_abierta
            FROM sucursal s
            LEFT JOIN venta_caja v ON v.id_sucursal = s.id_sucursal AND v.fecha_venta >= CURRENT_DATE
            GROUP BY s.id_sucursal
            ORDER BY ingresos DESC, s.nombre_sucursal
        `),
        !esAdmin ? [] : filas(`SELECT DISTINCT id_sucursal FROM turno_caja WHERE estado_turno = 'Abierto'`)
            .then(r => r.map(x => x.id_sucursal)),
        filas(`
            SELECT (SELECT COUNT(*) FROM promocion p
                    WHERE ($1::int = 0 OR p.id_sucursal IS NULL OR p.id_sucursal = $1) AND ${CONDICION_VIGENTE})::int AS vigentes,
                   ROUND(COALESCE(SUM(v.descuento_promociones), 0), 2)::float8 AS ahorro,
                   ROUND(COALESCE(SUM(v.descuento_manual), 0), 2)::float8 AS descuentos,
                   COUNT(*) FILTER (WHERE v.descuento_manual > 0)::int AS ventas_con_descuento
            FROM venta_caja v
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
        `, p).then(r => r[0]),
        // Ganancia de hoy (solo administrador): lo vendido con costo conocido menos su costo
        !esAdmin ? null : filas(`
            SELECT ROUND(COALESCE(SUM(dv.subtotal_venta) FILTER (WHERE dv.costo_unitario IS NOT NULL), 0), 2)::float8 AS ventas,
                   ROUND(COALESCE(SUM(dv.costo_unitario * dv.cantidad_vendida), 0), 2)::float8 AS costo,
                   COALESCE(SUM(dv.cantidad_vendida) FILTER (WHERE dv.costo_unitario IS NULL), 0)::int AS unidades_sin_costo
            FROM detalle_venta dv JOIN venta_caja v ON v.id_venta = dv.id_venta
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
        `, p).then(r => ({ ...r[0], ganancia: Math.round((r[0].ventas - r[0].costo) * 100) / 100 })),
        filas(`
            SELECT c.id_categoria, c.nombre_categoria, ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos
            FROM detalle_venta dv
            JOIN venta_caja v         ON v.id_venta = dv.id_venta
            JOIN producto p           ON p.id_producto = dv.id_producto
            JOIN categoria_producto c ON c.id_categoria = p.id_categoria
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE
            GROUP BY c.id_categoria, c.nombre_categoria ORDER BY ingresos DESC
        `, p),
        // Unidades vencidas y por vencer (lotes con stock)
        filas(`
            SELECT COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento <= LOCALTIMESTAMP), 0)::int AS vencidos,
                   COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento > LOCALTIMESTAMP
                                                            AND l.fecha_vencimiento <= LOCALTIMESTAMP + ${AVISO('p', 'cfg')}), 0)::int AS por_vencer
            FROM lote_inventario l
            JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
            JOIN producto p            ON p.id_producto   = i.id_producto
            CROSS JOIN configuracion cfg
            WHERE cfg.id_configuracion = 1 AND ${deSucursal('i.id_sucursal')} AND l.cantidad_actual > 0
        `, p).then(r => r[0]),
        filas(`
            SELECT p.nombre_producto, s.nombre_sucursal, l.cantidad_actual AS cantidad, l.fecha_vencimiento,
                   l.fecha_vencimiento <= LOCALTIMESTAMP AS vencido
            FROM lote_inventario l
            JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
            JOIN producto p            ON p.id_producto   = i.id_producto
            JOIN sucursal s            ON s.id_sucursal   = i.id_sucursal
            CROSS JOIN configuracion cfg
            WHERE cfg.id_configuracion = 1 AND ${deSucursal('i.id_sucursal')} AND l.cantidad_actual > 0
              AND l.fecha_vencimiento <= LOCALTIMESTAMP + ${AVISO('p', 'cfg')}
            ORDER BY l.fecha_vencimiento, p.nombre_producto
            LIMIT 8
        `, p),
        filas(`
            SELECT v.id_venta, v.numero_dia, v.fecha_venta, v.descuento_manual::float8 AS descuento, v.motivo_descuento AS motivo,
                   u.nombre_completo AS cajero, s.nombre_sucursal
            FROM venta_caja v
            JOIN sucursal s     ON s.id_sucursal = v.id_sucursal
            LEFT JOIN usuario u ON u.id_usuario = v.id_usuario_cajero
            WHERE ${deSucursal('v.id_sucursal')} AND v.fecha_venta >= CURRENT_DATE AND v.descuento_manual > 0
            ORDER BY v.fecha_venta DESC
            LIMIT 8
        `, p)
    ]);

    return {
        hoy,
        comparativo: { ayer_misma_hora: ayerHora, ayer_total: ayerTotal, semana_pasada_misma_hora: semanaHora },
        metodos_pago: metodos,
        por_hora: porHora,
        por_hora_promedio: promedioHora,
        top_productos: productos,
        turnos_abiertos: turnos,
        mesas: { ...mesas, por_cobrar: await promocionModel.porCobrarMesas(Number(id_sucursal) || 0) }, pedidos_qr: pedidos,
        stock, stock_critico: stockCritico,
        ultimas_ventas: ultimas,
        sucursales,
        cajas_abiertas: cajas,
        promociones,
        ...(costoHoy ? { costo_hoy: costoHoy } : {}),
        categorias_hoy: categoriasHoy,
        vencimientos, por_vencer: porVencer,
        descuentos_hoy: descuentosHoy
    };
};

// ─── Informe por período ───
// Las ventas del período se arman una vez (CTE "v"); con filtro de categorías el monto
// de cada venta es solo la parte de esas categorías.
const ventasDelPeriodo = (filtra) => `
    v AS (
        SELECT vc.id_venta, vc.id_sucursal, vc.fecha_venta, vc.metodo_pago, vc.id_usuario_cajero,
               ${filtra ? 'f.monto' : 'vc.monto_total_venta'} AS monto
        FROM venta_caja vc
        ${filtra ? `JOIN (SELECT dv.id_venta, SUM(dv.subtotal_venta) AS monto
                          FROM detalle_venta dv JOIN producto p ON p.id_producto = dv.id_producto
                          WHERE p.id_categoria = ANY($4::int[])
                          GROUP BY dv.id_venta) f ON f.id_venta = vc.id_venta` : ''}
        WHERE ${deSucursal('vc.id_sucursal')}
          AND vc.fecha_venta >= $2::date AND vc.fecha_venta < $3::date + 1
    )`;

// Período anterior de igual duración (fechas YYYY-MM-DD)
const periodoAnterior = (inicio, fin) => {
    const dia = 86400000;
    const a = Date.parse(inicio + 'T00:00:00Z');
    const b = Date.parse(fin + 'T00:00:00Z');
    const n = Math.round((b - a) / dia) + 1;
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    return [iso(a - n * dia), iso(a - dia)];
};

const obtenerInforme = async (id_sucursal, inicio, fin, categorias = null, { conCostos = false } = {}) => {
    const filtra = Array.isArray(categorias) && categorias.length > 0;
    const cte    = `WITH ${ventasDelPeriodo(filtra)}`;
    const conCat = (params) => filtra ? [...params, categorias] : params;
    const params = conCat([id_sucursal, inicio, fin]);
    const soloCat = filtra ? 'AND p.id_categoria = ANY($4::int[])' : '';
    const dias = `generate_series($2::date::timestamp, $3::date::timestamp, INTERVAL '1 day')`;

    const resumenSql = `
        ${cte}
        SELECT COUNT(*)::int AS total_ventas,
               ROUND(COALESCE(SUM(monto), 0), 2)::float8 AS ingresos_totales,
               ROUND(COALESCE(AVG(monto), 0), 2)::float8 AS ticket_promedio,
               ROUND(COALESCE(MAX(monto), 0), 2)::float8 AS venta_maxima,
               COUNT(DISTINCT fecha_venta::date)::int    AS dias_con_venta,
               COALESCE((SELECT SUM(dv.cantidad_vendida) FROM v v2
                         JOIN detalle_venta dv ON dv.id_venta = v2.id_venta
                         JOIN producto p ON p.id_producto = dv.id_producto
                         WHERE TRUE ${soloCat}), 0)::int AS unidades
        FROM v`;

    const porProducto = `
        ${cte}
        SELECT p.id_producto, p.nombre_producto, c.nombre_categoria,
               SUM(dv.cantidad_vendida)::int AS unidades,
               ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos
        FROM v
        JOIN detalle_venta dv     ON dv.id_venta = v.id_venta
        JOIN producto p           ON p.id_producto = dv.id_producto
        JOIN categoria_producto c ON c.id_categoria = p.id_categoria
        WHERE TRUE ${soloCat}
        GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
        ORDER BY ingresos DESC, unidades DESC`;

    const [
        resumen, anterior, diario, metodos, cajeros, horas, semana, porCategoria, productos,
        sinVentas, cierres, inventario, pedidos, sucursales
    ] = await Promise.all([
        filas(resumenSql, params).then(r => r[0]),
        filas(resumenSql, conCat([id_sucursal, ...periodoAnterior(inicio, fin)])).then(r => r[0]),
        filas(`
            ${cte}
            SELECT d::date::text AS dia, COUNT(v.id_venta)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto), 0), 2)::float8 AS ingresos
            FROM ${dias} d
            LEFT JOIN v ON v.fecha_venta >= d AND v.fecha_venta < d + INTERVAL '1 day'
            GROUP BY d ORDER BY d
        `, params),
        filas(`
            ${cte}
            SELECT metodo_pago, COUNT(*)::int AS ventas, ROUND(SUM(monto), 2)::float8 AS ingresos
            FROM v GROUP BY metodo_pago ORDER BY ingresos DESC
        `, params),
        filas(`
            ${cte}
            SELECT COALESCE(u.nombre_completo, 'Sin registro') AS cajero, COUNT(*)::int AS ventas,
                   ROUND(SUM(v.monto), 2)::float8 AS ingresos, ROUND(AVG(v.monto), 2)::float8 AS ticket
            FROM v LEFT JOIN usuario u ON u.id_usuario = v.id_usuario_cajero
            GROUP BY u.id_usuario, u.nombre_completo ORDER BY ingresos DESC
        `, params),
        filas(`
            ${cte}
            SELECT EXTRACT(HOUR FROM fecha_venta)::int AS hora, COUNT(*)::int AS ventas,
                   ROUND(SUM(monto), 2)::float8 AS ingresos
            FROM v GROUP BY 1 ORDER BY 1
        `, params),
        filas(`
            ${cte}, dias AS (SELECT d::date AS d FROM ${dias} d)
            SELECT EXTRACT(ISODOW FROM dias.d)::int AS dia_semana,
                   COUNT(DISTINCT dias.d)::int AS dias,
                   COUNT(v.id_venta)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto), 0), 2)::float8 AS ingresos
            FROM dias LEFT JOIN v ON v.fecha_venta::date = dias.d
            GROUP BY 1 ORDER BY 1
        `, params),
        filas(`
            ${cte}
            SELECT c.id_categoria, c.nombre_categoria,
                   SUM(dv.cantidad_vendida)::int AS unidades,
                   ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos
            FROM v
            JOIN detalle_venta dv     ON dv.id_venta = v.id_venta
            JOIN producto p           ON p.id_producto = dv.id_producto
            JOIN categoria_producto c ON c.id_categoria = p.id_categoria
            WHERE TRUE ${soloCat}
            GROUP BY c.id_categoria, c.nombre_categoria ORDER BY ingresos DESC
        `, params),
        filas(porProducto, params),
        filas(`
            SELECT p.nombre_producto, c.nombre_categoria, p.precio_unitario::float8 AS precio,
                   COALESCE(SUM(GREATEST(i.cantidad_actual, 0)), 0)::int AS stock
            FROM producto p
            JOIN categoria_producto c  ON c.id_categoria = p.id_categoria
            JOIN inventario_sucursal i ON i.id_producto = p.id_producto AND ${deSucursal('i.id_sucursal')}
            WHERE p.estado_activo ${soloCat}
              AND NOT EXISTS (
                  SELECT 1 FROM detalle_venta dv JOIN venta_caja vc ON vc.id_venta = dv.id_venta
                  WHERE dv.id_producto = p.id_producto AND ${deSucursal('vc.id_sucursal')}
                    AND vc.fecha_venta >= $2::date AND vc.fecha_venta < $3::date + 1)
            GROUP BY p.id_producto, p.nombre_producto, c.nombre_categoria
            ORDER BY c.nombre_categoria, stock DESC, p.nombre_producto
        `, params),
        filas(`
            SELECT t.id_turno, u.nombre_completo AS cajero, s.nombre_sucursal,
                   t.fecha_hora_apertura, t.fecha_hora_cierre, t.monto_inicial::float8 AS monto_inicial,
                   t.monto_calculado::float8 AS efectivo_esperado, t.monto_real_declarado::float8 AS efectivo_contado,
                   t.diferencia::float8 AS diferencia, t.cerrado_por,
                   COUNT(v.id_venta)::int AS ventas,
                   ROUND(COALESCE(SUM(v.monto_total_venta), 0), 2)::float8 AS total,
                   ROUND(COALESCE(SUM(v.monto_total_venta) FILTER (WHERE v.metodo_pago = '${METODO_PAGO.efectivo}'), 0), 2)::float8 AS efectivo
            FROM turno_caja t
            JOIN usuario u  ON u.id_usuario = t.id_usuario_cajero
            JOIN sucursal s ON s.id_sucursal = t.id_sucursal
            LEFT JOIN venta_caja v ON v.id_turno = t.id_turno
            WHERE t.estado_turno = 'Cerrado' AND ${deSucursal('t.id_sucursal')}
              AND t.fecha_hora_cierre >= $2::date AND t.fecha_hora_cierre < $3::date + 1
            GROUP BY t.id_turno, u.nombre_completo, s.nombre_sucursal
            ORDER BY t.fecha_hora_cierre DESC
        `, [id_sucursal, inicio, fin]),
        filas(`
            SELECT COUNT(*)::int AS productos,
                   COALESCE(SUM(GREATEST(i.cantidad_actual, 0)), 0)::int AS unidades,
                   ROUND(COALESCE(SUM(GREATEST(i.cantidad_actual, 0) * p.precio_unitario), 0), 2)::float8 AS valor_venta,
                   COUNT(*) FILTER (WHERE i.cantidad_actual <= 0)::int AS agotados,
                   COUNT(*) FILTER (WHERE i.cantidad_actual > 0 AND i.cantidad_actual <= (SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1))::int AS bajos
            FROM inventario_sucursal i
            JOIN producto p ON p.id_producto = i.id_producto AND p.estado_activo AND p.tipo_producto <> 'PREPARADO'
            WHERE ${deSucursal('i.id_sucursal')}
        `, [id_sucursal]).then(r => r[0]),
        filas(`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE pm.estado_pedido IN ('Confirmado', 'Entregado', 'Pagado'))::int AS atendidos,
                   COUNT(*) FILTER (WHERE pm.estado_pedido = 'Cancelado')::int AS cancelados,
                   ROUND(COALESCE(SUM((SELECT SUM(dp.subtotal_detalle) FROM detalle_pedido dp WHERE dp.id_pedido = pm.id_pedido)) FILTER (WHERE pm.estado_pedido <> 'Cancelado'), 0), 2)::float8 AS monto
            FROM pedido_mesa pm
            LEFT JOIN mesa_local m ON m.id_mesa = pm.id_mesa
            WHERE ${deSucursal('COALESCE(pm.id_sucursal, m.id_sucursal)')}
              AND pm.fecha_pedido >= $2::date AND pm.fecha_pedido < $3::date + 1
        `, [id_sucursal, inicio, fin]).then(r => r[0]),
        id_sucursal !== 0 ? [] : filas(`
            ${cte}
            SELECT s.nombre_sucursal, COUNT(*)::int AS ventas,
                   ROUND(SUM(v.monto), 2)::float8 AS ingresos, ROUND(AVG(v.monto), 2)::float8 AS ticket
            FROM v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
            GROUP BY s.id_sucursal, s.nombre_sucursal ORDER BY ingresos DESC
        `, params)
    ]);

    return {
        resumen, anterior,
        periodo_anterior: periodoAnterior(inicio, fin),
        ventas_diarias: diario,
        metodos_pago: metodos,
        por_cajero: cajeros,
        por_hora: horas,
        por_dia_semana: semana,
        por_categoria: porCategoria,
        productos,
        sin_ventas: sinVentas,
        cierres, inventario,
        pedidos_qr: pedidos,
        por_sucursal: sucursales,
        filtro_categorias: filtra ? categorias : [],
        descuentos: await descuentosDelPeriodo(id_sucursal, inicio, fin),
        ...(await ritmoDelPeriodo(cte, params)),
        ...(conCostos ? { costos: await costosDelPeriodo(cte, params, soloCat),
                          mermas: await mermasDelPeriodo(id_sucursal, inicio, fin, categorias) } : {})
    };
};

// ─── Cuándo se vende y cómo se cobra cada día ───
// calor: ventas por día de la semana (1 = lunes) y hora; la pantalla saca el promedio con por_dia_semana[].dias
const ritmoDelPeriodo = async (cte, params) => {
    const [calor, metodosPorDia] = await Promise.all([
        filas(`
            ${cte}
            SELECT EXTRACT(ISODOW FROM fecha_venta)::int AS dia_semana, EXTRACT(HOUR FROM fecha_venta)::int AS hora,
                   COUNT(*)::int AS ventas, ROUND(SUM(monto), 2)::float8 AS ingresos
            FROM v GROUP BY 1, 2 ORDER BY 1, 2`, params),
        filas(`
            ${cte}
            SELECT to_char(fecha_venta::date, 'YYYY-MM-DD') AS dia, metodo_pago, ROUND(SUM(monto), 2)::float8 AS ingresos
            FROM v GROUP BY 1, 2 ORDER BY 1`, params)
    ]);
    return { calor, metodos_por_dia: metodosPorDia };
};

// ─── Mermas y vencidos del período (solo administrador): salidas manuales, valoradas con el costo de sus lotes ───
const MOTIVOS_MERMA = ['Vencido', 'Dañado', 'Consumo interno', 'Degustación', 'Ajuste de conteo', 'Otro'];
const mermasDelPeriodo = async (id_sucursal, inicio, fin, categorias = null) => {
    const sql = (desde, hasta) => filas(`
        SELECT h.motivo_movimiento AS motivo, SUM(h.cantidad_movida)::int AS unidades,
               ROUND(COALESCE(SUM(v.valor), 0), 2)::float8 AS valor, bool_or(v.valor IS NULL) AS sin_costo
        FROM historial_inventario h
        JOIN inventario_sucursal i ON i.id_inventario = h.id_inventario
        JOIN producto p            ON p.id_producto   = i.id_producto
        LEFT JOIN LATERAL (
            SELECT CASE WHEN COUNT(*) > 0 AND COUNT(l.costo_unitario) = COUNT(*) THEN ABS(SUM(ml.cantidad * l.costo_unitario)) END AS valor
            FROM movimiento_lote ml JOIN lote_inventario l ON l.id_lote = ml.id_lote
            WHERE ml.id_historial = h.id_historial
        ) v ON TRUE
        WHERE ${deSucursal('i.id_sucursal')} AND h.tipo_movimiento = 'SALIDA' AND h.motivo_movimiento = ANY($4::text[])
          AND h.fecha_registro >= $2::date AND h.fecha_registro < $3::date + 1
          AND ($5::int[] IS NULL OR p.id_categoria = ANY($5::int[]))
        GROUP BY 1 ORDER BY valor DESC, unidades DESC`, [id_sucursal, desde, hasta, MOTIVOS_MERMA, categorias]);
    const [actual, anterior] = await Promise.all([sql(inicio, fin), sql(...periodoAnterior(inicio, fin))]);
    const suma = (l) => Math.round(l.reduce((t, m) => t + m.valor, 0) * 100) / 100;
    return { por_motivo: actual, total: suma(actual), unidades: actual.reduce((t, m) => t + m.unidades, 0), total_anterior: suma(anterior) };
};

// ─── Costo de lo vendido (solo administrador) ───
// Costo = solo insumos, el de los lotes de los que salió cada venta (lo preparado, su receta).
// Lo vendido sin costo conocido (antes de los lotes o sin receta) no entra en la ganancia y se muestra aparte.
const costosDelPeriodo = async (cte, params, soloCat) => {
    const LINEAS = `FROM v
        JOIN detalle_venta dv ON dv.id_venta = v.id_venta
        JOIN producto p       ON p.id_producto = dv.id_producto
        WHERE TRUE ${soloCat}`;
    const [resumen, productos, porCategoria] = await Promise.all([
        filas(`
            ${cte}
            SELECT ROUND(COALESCE(SUM(dv.subtotal_venta) FILTER (WHERE dv.costo_unitario IS NOT NULL), 0), 2)::float8 AS ventas,
                   ROUND(COALESCE(SUM(dv.costo_unitario * dv.cantidad_vendida), 0), 2)::float8 AS costo,
                   COALESCE(SUM(dv.cantidad_vendida) FILTER (WHERE dv.costo_unitario IS NULL), 0)::int AS unidades_sin_costo,
                   ROUND(COALESCE(SUM(dv.subtotal_venta) FILTER (WHERE dv.costo_unitario IS NULL), 0), 2)::float8 AS ventas_sin_costo
            ${LINEAS}`, params).then(r => r[0]),
        filas(`
            ${cte}
            SELECT p.id_producto, p.nombre_producto,
                   SUM(dv.cantidad_vendida)::int AS unidades,
                   ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos,
                   ROUND(SUM(dv.costo_unitario * dv.cantidad_vendida), 2)::float8 AS costo,
                   bool_or(dv.costo_unitario IS NULL) AS sin_costo
            ${LINEAS}
            GROUP BY p.id_producto, p.nombre_producto
            ORDER BY ingresos DESC`, params),
        // Por categoría: solo lo que tiene costo conocido
        filas(`
            ${cte}
            SELECT c.id_categoria, c.nombre_categoria,
                   ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos,
                   ROUND(SUM(dv.costo_unitario * dv.cantidad_vendida), 2)::float8 AS costo
            FROM v
            JOIN detalle_venta dv     ON dv.id_venta = v.id_venta
            JOIN producto p           ON p.id_producto = dv.id_producto
            JOIN categoria_producto c ON c.id_categoria = p.id_categoria
            WHERE dv.costo_unitario IS NOT NULL ${soloCat}
            GROUP BY c.id_categoria, c.nombre_categoria`, params)
    ]);
    const ganancia = Math.round((resumen.ventas - resumen.costo) * 100) / 100;
    return {
        resumen: { ...resumen, ganancia, margen: resumen.ventas ? Math.round(ganancia * 1000 / resumen.ventas) / 10 : null },
        por_categoria: porCategoria.map(c => {
            const g = Math.round((c.ingresos - c.costo) * 100) / 100;
            return { ...c, ganancia: g, margen: c.ingresos ? Math.round(g * 1000 / c.ingresos) / 10 : null };
        }).sort((a, b) => b.ganancia - a.ganancia),
        productos: productos.map(p => {
            const g = p.sin_costo ? null : Math.round((p.ingresos - p.costo) * 100) / 100;
            return { ...p, costo: p.sin_costo ? null : p.costo, ganancia: g,
                     margen: g == null || !p.ingresos ? null : Math.round(g * 1000 / p.ingresos) / 10 };
        })
    };
};

// Promociones aplicadas y descuentos manuales del período (sin filtro de categorías)
const descuentosDelPeriodo = async (id_sucursal, inicio, fin) => {
    const params = [id_sucursal, inicio, fin];
    const enPeriodo = `${deSucursal('vc.id_sucursal')} AND vc.fecha_venta >= $2::date AND vc.fecha_venta < $3::date + 1`;
    const [resumen, promociones, porCajero, manuales] = await Promise.all([
        filas(`
            SELECT ROUND(COALESCE(SUM(vc.descuento_promociones), 0), 2)::float8 AS promociones,
                   ROUND(COALESCE(SUM(vc.descuento_manual), 0), 2)::float8 AS manual,
                   COUNT(*) FILTER (WHERE vc.descuento_promociones > 0)::int AS ventas_con_promocion,
                   COUNT(*) FILTER (WHERE vc.descuento_manual > 0)::int AS ventas_con_descuento
            FROM venta_caja vc WHERE ${enPeriodo}
        `, params).then(r => r[0]),
        filas(`
            SELECT pr.id_promocion, pr.nombre, pr.tipo, pr.valor::float8 AS valor, pr.lleva, pr.paga,
                   COUNT(DISTINCT dv.id_venta)::int AS ventas,
                   SUM(dv.cantidad_vendida)::int AS unidades,
                   ROUND(SUM(dv.descuento_promocion), 2)::float8 AS ahorro,
                   ROUND(SUM(dv.subtotal_venta), 2)::float8 AS ingresos
            FROM venta_caja vc
            JOIN detalle_venta dv ON dv.id_venta = vc.id_venta
            JOIN promocion pr     ON pr.id_promocion = dv.id_promocion
            WHERE ${enPeriodo}
            GROUP BY pr.id_promocion
            ORDER BY ahorro DESC
        `, params),
        filas(`
            SELECT u.nombre_completo AS cajero, COUNT(*)::int AS ventas,
                   ROUND(SUM(vc.descuento_manual), 2)::float8 AS descuento,
                   ROUND(SUM(vc.monto_total_venta), 2)::float8 AS cobrado
            FROM venta_caja vc JOIN usuario u ON u.id_usuario = vc.id_usuario_cajero
            WHERE ${enPeriodo} AND vc.descuento_manual > 0
            GROUP BY u.id_usuario, u.nombre_completo
            ORDER BY descuento DESC
        `, params),
        filas(`
            SELECT vc.id_venta, vc.numero_dia, vc.fecha_venta, u.nombre_completo AS cajero, s.nombre_sucursal,
                   vc.monto_total_venta::float8 AS cobrado, vc.descuento_manual::float8 AS descuento, vc.motivo_descuento AS motivo
            FROM venta_caja vc
            JOIN usuario  u ON u.id_usuario  = vc.id_usuario_cajero
            JOIN sucursal s ON s.id_sucursal = vc.id_sucursal
            WHERE ${enPeriodo} AND vc.descuento_manual > 0
            ORDER BY vc.fecha_venta DESC
            LIMIT 100
        `, params)
    ]);
    return { resumen, promociones, por_cajero: porCajero, manuales };
};


module.exports = { obtenerPanel, obtenerInforme, periodoAnterior };
