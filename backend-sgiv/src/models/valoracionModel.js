const db = require('../config/db');
const { AVISO } = require('./loteModel');

// ─── Inventario valorado y kardex (PEPS, solo insumos) ───
// Todo sale de los lotes (costo de cada uno), de movimiento_lote (qué lote tocó cada movimiento)
// y de historial_inventario. Lo preparado al momento no tiene stock: no aparece.

const redondear = (n, d = 2) => n == null ? null : Math.round(Number(n) * 10 ** d) / 10 ** d;

/**
 * Momento de corte: hoy = ahora; otro día = el final de ese día.
 * Cantidad de un lote en el corte = la de ahora menos lo que se movió después.
 */
const CORTE = (f = '$2') => `(SELECT CASE WHEN ${f}::date >= CURRENT_DATE THEN LOCALTIMESTAMP ELSE (${f}::date + 1)::timestamp END AS t)`;
const CANTIDAD_EN_CORTE = `l.cantidad_actual - COALESCE((
        SELECT SUM(ml.cantidad) FROM movimiento_lote ml
        JOIN historial_inventario h ON h.id_historial = ml.id_historial
        WHERE ml.id_lote = l.id_lote AND h.fecha_registro >= corte.t), 0)`;

/**
 * id_sucursal 0 = todas. fecha: AAAA-MM-DD (corte). categorias: ids o null.
 * Devuelve { corte, categorias: [{ nombre, productos: [...], totales }], totales }
 */
const inventarioValorado = async ({ id_sucursal, fecha, categorias = null }) => {
    const r = await db.query(`
        SELECT * FROM (
            SELECT l.id_lote, l.fecha_ingreso, l.fecha_vencimiento, l.costo_unitario::float8 AS costo_unitario,
                   (${CANTIDAD_EN_CORTE})::int AS cantidad,
                   CASE WHEN l.fecha_vencimiento <= corte.t THEN 'VENCIDO'
                        WHEN l.fecha_vencimiento <= corte.t + ${AVISO('p', 'c')} THEN 'POR_VENCER'
                        ELSE 'VIGENTE' END AS estado,
                   i.id_sucursal, s.nombre_sucursal,
                   p.id_producto, p.nombre_producto, p.tipo_producto, p.precio_unitario::float8 AS precio,
                   cat.id_categoria, COALESCE(cat.nombre_categoria, 'SIN CATEGORÍA') AS nombre_categoria, COALESCE(cat.orden, 0) AS orden
            FROM lote_inventario l
            JOIN inventario_sucursal i       ON i.id_inventario = l.id_inventario
            JOIN producto p                  ON p.id_producto   = i.id_producto
            JOIN sucursal s                  ON s.id_sucursal   = i.id_sucursal
            LEFT JOIN categoria_producto cat ON cat.id_categoria = p.id_categoria
            CROSS JOIN configuracion c
            CROSS JOIN ${CORTE()} corte
            WHERE c.id_configuracion = 1 AND ($1::int = 0 OR i.id_sucursal = $1)
              AND p.tipo_producto <> 'PREPARADO' AND l.fecha_ingreso < corte.t
              AND ($3::int[] IS NULL OR p.id_categoria = ANY($3::int[]))
        ) x
        WHERE cantidad > 0
        ORDER BY orden, nombre_categoria, nombre_producto, id_sucursal, fecha_ingreso, id_lote`,
        [id_sucursal, fecha, categorias]);

    // Por categoría → producto (y sucursal, si son todas) → lotes
    const cats = new Map();
    for (const l of r.rows) {
        const c = cats.get(l.nombre_categoria) ?? { nombre: l.nombre_categoria, productos: new Map() };
        const clave = `${l.id_producto}-${l.id_sucursal}`;
        const p = c.productos.get(clave) ?? {
            id_producto: l.id_producto, nombre_producto: l.nombre_producto, tipo_producto: l.tipo_producto,
            id_sucursal: l.id_sucursal, nombre_sucursal: l.nombre_sucursal, precio: l.precio,
            cantidad: 0, sin_costo: 0, valor_costo: 0, por_vencer: 0, vencidos: 0, lotes: []
        };
        p.cantidad += l.cantidad;
        if (l.costo_unitario == null) p.sin_costo += l.cantidad;
        else p.valor_costo += l.cantidad * l.costo_unitario;
        if (l.estado === 'VENCIDO') p.vencidos += l.cantidad;
        if (l.estado === 'POR_VENCER') p.por_vencer += l.cantidad;
        p.lotes.push({ id_lote: l.id_lote, fecha_ingreso: l.fecha_ingreso, fecha_vencimiento: l.fecha_vencimiento,
                       cantidad: l.cantidad, costo_unitario: l.costo_unitario, estado: l.estado,
                       valor: l.costo_unitario == null ? null : redondear(l.cantidad * l.costo_unitario) });
        c.productos.set(clave, p);
        cats.set(l.nombre_categoria, c);
    }

    const sumar = (lista) => {
        const t = { cantidad: 0, sin_costo: 0, valor_costo: 0, valor_venta: 0, ganancia: 0 };
        for (const p of lista) for (const k of Object.keys(t)) t[k] += p[k] ?? 0;
        for (const k of ['valor_costo', 'valor_venta', 'ganancia']) t[k] = redondear(t[k]);
        return t;
    };
    const categoriasLista = [...cats.values()].map(c => {
        const productos = [...c.productos.values()].map(p => {
            const conCosto = p.cantidad - p.sin_costo;
            const valor_venta = redondear(p.cantidad * p.precio);
            const valor_costo = redondear(p.valor_costo);
            return {
                ...p, valor_costo, valor_venta,
                costo_promedio: conCosto ? redondear(p.valor_costo / conCosto, 4) : null,
                // Ganancia esperada: solo de lo que tiene costo conocido
                ganancia: redondear(conCosto * p.precio - p.valor_costo)
            };
        });
        return { nombre: c.nombre, productos, totales: sumar(productos) };
    });
    const corte = (await db.query(`SELECT to_char(t, 'YYYY-MM-DD"T"HH24:MI:SS') AS t FROM ${CORTE('$1')} c`, [fecha])).rows[0].t;
    return { corte, categorias: categoriasLista, totales: sumar(categoriasLista.flatMap(c => c.productos)) };
};

/**
 * Kardex de un producto en una sucursal entre desde y hasta (AAAA-MM-DD).
 * Saldo inicial = el de ahora menos todo lo movido desde «desde»; cada salida vale lo de sus lotes.
 * El valor del saldo es null si algún movimiento no tiene costo conocido (de antes de los lotes o sin receta).
 */
const kardex = async ({ id_sucursal, id_producto, desde, hasta }) => {
    const rInv = await db.query(`
        SELECT i.id_inventario, i.cantidad_actual, p.id_producto, p.nombre_producto, p.tipo_producto, s.nombre_sucursal,
               COALESCE(cat.nombre_categoria, 'SIN CATEGORÍA') AS nombre_categoria
        FROM inventario_sucursal i
        JOIN producto p ON p.id_producto = i.id_producto
        JOIN sucursal s ON s.id_sucursal = i.id_sucursal
        LEFT JOIN categoria_producto cat ON cat.id_categoria = p.id_categoria
        WHERE i.id_sucursal = $1 AND i.id_producto = $2`, [id_sucursal, id_producto]);
    const inv = rInv.rows[0];
    if (!inv) return null;

    const [rMov, rDespues, rValorInicial] = await Promise.all([
        db.query(`
            SELECT h.id_historial, h.fecha_registro, h.tipo_movimiento, h.cantidad_movida, h.motivo_movimiento, h.detalle,
                   h.id_detalle_cuenta, h.id_pedido,
                   u.nombre_completo AS usuario, v.valor::float8 AS valor, v.lotes, v.con_costo,
                   s.valor::float8 AS saldo_valor, s.unidades AS saldo_unidades, s.incompleto AS saldo_incompleto
            FROM historial_inventario h
            LEFT JOIN usuario u ON u.id_usuario = h.id_usuario
            -- Valor del movimiento: lo que tocó de cada lote por su costo
            LEFT JOIN LATERAL (
                SELECT ABS(SUM(ml.cantidad * l.costo_unitario)) AS valor, COUNT(*)::int AS lotes,
                       COUNT(l.costo_unitario)::int AS con_costo
                FROM movimiento_lote ml JOIN lote_inventario l ON l.id_lote = ml.id_lote
                WHERE ml.id_historial = h.id_historial
            ) v ON TRUE
            -- Saldo después del movimiento: los lotes que había en ese momento (lo de después se descuenta)
            LEFT JOIN LATERAL (
                SELECT SUM(x.q * x.costo_unitario) AS valor, COALESCE(SUM(x.q), 0)::int AS unidades,
                       COALESCE(bool_or(x.costo_unitario IS NULL AND x.q > 0), FALSE) AS incompleto
                FROM (
                    SELECT l.costo_unitario, l.cantidad_actual - COALESCE((
                               SELECT SUM(ml2.cantidad) FROM movimiento_lote ml2
                               WHERE ml2.id_lote = l.id_lote AND ml2.id_historial > h.id_historial), 0) AS q
                    FROM lote_inventario l
                    WHERE l.id_inventario = h.id_inventario AND l.fecha_ingreso <= h.fecha_registro
                ) x
            ) s ON TRUE
            WHERE h.id_inventario = $1 AND h.fecha_registro >= $2::date AND h.fecha_registro < $3::date + 1
            ORDER BY h.fecha_registro, h.id_historial`, [inv.id_inventario, desde, hasta]),
        // Lo movido desde «desde» hasta hoy (para llegar al saldo inicial)
        db.query(`
            SELECT COALESCE(SUM(CASE WHEN tipo_movimiento = 'INGRESO' THEN cantidad_movida ELSE -cantidad_movida END), 0)::int AS neto
            FROM historial_inventario WHERE id_inventario = $1 AND fecha_registro >= $2::date`, [inv.id_inventario, desde]),
        // Valor de los lotes al empezar «desde»
        db.query(`
            SELECT COALESCE(SUM(cantidad * costo_unitario), 0)::float8 AS valor, bool_or(costo_unitario IS NULL AND cantidad > 0) AS incompleto
            FROM (
                SELECT l.costo_unitario, (l.cantidad_actual - COALESCE((
                           SELECT SUM(ml.cantidad) FROM movimiento_lote ml
                           JOIN historial_inventario h ON h.id_historial = ml.id_historial
                           WHERE ml.id_lote = l.id_lote AND h.fecha_registro >= $2::date), 0)) AS cantidad
                FROM lote_inventario l WHERE l.id_inventario = $1 AND l.fecha_ingreso < $2::date
            ) x`, [inv.id_inventario, desde])
    ]);

    const preparado = inv.tipo_producto === 'PREPARADO';
    let cantidad = preparado ? 0 : Number(inv.cantidad_actual) - rDespues.rows[0].neto;
    // Antes de los lotes no hay costo: si había stock y ningún lote lo explica, el valor no se conoce
    const lotesIniciales = rValorInicial.rows[0];
    let valor = lotesIniciales.incompleto ? null : lotesIniciales.valor;
    if (valor === 0 && cantidad > 0) valor = null;
    const inicial = { cantidad, valor: redondear(valor) };

    const totales = { entradas: 0, valor_entradas: 0, salidas: 0, valor_salidas: 0, sin_costo: false };
    const movimientos = [];
    for (const m of rMov.rows) {
        const entra = m.tipo_movimiento === 'INGRESO';
        const conCosto = m.lotes > 0 && m.con_costo === m.lotes;
        cantidad += entra ? m.cantidad_movida : -m.cantidad_movida;
        if (!conCosto) totales.sin_costo = true;
        // El saldo vale lo de sus lotes si los lotes explican todo el stock y todos tienen costo
        valor = m.saldo_unidades === cantidad && !m.saldo_incompleto ? (m.saldo_valor ?? 0) : null;
        if (entra) { totales.entradas += m.cantidad_movida; if (conCosto) totales.valor_entradas += m.valor; }
        else       { totales.salidas  += m.cantidad_movida; if (conCosto) totales.valor_salidas  += m.valor; }

        // En una mesa cada toque reserva una unidad: lo seguido de la misma línea de la cuenta
        // (o del mismo pedido QR) es un solo movimiento en el kardex
        const referencia = m.id_detalle_cuenta || m.id_pedido ? `${m.id_detalle_cuenta ?? ''}-${m.id_pedido ?? ''}` : null;
        const ultimo = movimientos.at(-1);
        if (referencia && ultimo && ultimo.referencia === referencia && ultimo.tipo === m.tipo_movimiento
            && ultimo.motivo === m.motivo_movimiento && ultimo.usuario === m.usuario) {
            ultimo.cantidad += m.cantidad_movida;
            ultimo.valor = ultimo.valor == null || !conCosto ? null : ultimo.valor + m.valor;
            ultimo.fecha = m.fecha_registro;
            ultimo.saldo = { cantidad, valor };
            continue;
        }
        movimientos.push({
            id_historial: m.id_historial, fecha: m.fecha_registro, motivo: m.motivo_movimiento, detalle: m.detalle,
            usuario: m.usuario, tipo: m.tipo_movimiento, cantidad: m.cantidad_movida, referencia,
            valor: conCosto ? m.valor : null, saldo: { cantidad, valor }
        });
    }
    for (const x of movimientos) {
        x.total = redondear(x.valor);
        x.costo_unitario = x.valor == null ? null : redondear(x.valor / x.cantidad, 4);
        x.saldo = { cantidad: x.saldo.cantidad, valor: redondear(x.saldo.valor) };
        delete x.valor; delete x.referencia;
    }
    totales.valor_entradas = redondear(totales.valor_entradas);
    totales.valor_salidas  = redondear(totales.valor_salidas);

    return {
        producto: { id_producto: inv.id_producto, nombre_producto: inv.nombre_producto, tipo_producto: inv.tipo_producto,
                    nombre_categoria: inv.nombre_categoria, nombre_sucursal: inv.nombre_sucursal },
        inicial, movimientos, totales, final: { cantidad, valor: redondear(valor) }
    };
};

module.exports = { inventarioValorado, kardex };
