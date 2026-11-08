// ─── Lotes de inventario (PEPS: primero en entrar, primero en salir) ───
// Cada ingreso crea un lote con su vencimiento; cada salida sale del lote más antiguo.
// Solo se llama desde inventarioModel.moverStock, dentro de su transacción y con la fila
// de inventario bloqueada: eso ordena los cambios de los lotes de ese producto y sucursal.
// Un vencido NO se bloquea: el cajero decide si aún se vende.

// Vencimiento de un ingreso nuevo: vida útil del producto o la de Ajustes según su tipo
const VENCE = `
    SELECT LOCALTIMESTAMP + make_interval(hours => COALESCE(p.vida_util_horas,
               CASE p.tipo_producto WHEN 'COMPRADO' THEN c.vida_util_comprado_dias * 24
                                    ELSE c.vida_util_elaborado_horas END)) AS vence
    FROM inventario_sucursal i
    JOIN producto p ON p.id_producto = i.id_producto
    CROSS JOIN configuracion c
    WHERE i.id_inventario = $1 AND c.id_configuracion = 1`;

// ─── Costo por unidad (solo insumos; el sistema nunca pone precios) ───
// Elaborado y preparado: inversión de su receta ÷ rendimiento (NULL sin receta).
// Comprado: el costo del último lote comprado de ese producto en cualquier sucursal.
const COSTO_DE_PRODUCTO = (p = 'p') => `(CASE WHEN ${p}.tipo_producto = 'COMPRADO'
    THEN (SELECT l2.costo_unitario FROM lote_inventario l2 JOIN inventario_sucursal i2 ON i2.id_inventario = l2.id_inventario
          WHERE i2.id_producto = ${p}.id_producto AND l2.costo_unitario IS NOT NULL
          ORDER BY l2.fecha_ingreso DESC, l2.id_lote DESC LIMIT 1)
    ELSE (SELECT ROUND(r.inversion / r.rendimiento, 4) FROM receta r WHERE r.id_producto = ${p}.id_producto) END)`;

/** Costo por unidad que tendría hoy un ingreso del producto (null = sin costo) */
const costoActual = async (client, id_producto) => {
    const r = await client.query(`SELECT ${COSTO_DE_PRODUCTO()} AS costo FROM producto p WHERE p.id_producto = $1`, [id_producto]);
    return r.rows[0]?.costo == null ? null : Number(r.rows[0].costo);
};

/** Costo medio de lo que salió de unos lotes; null si alguno no tiene costo */
const costoDeLotes = (tomados) => {
    const unidades = tomados.reduce((s, t) => s + t.cantidad, 0);
    if (!unidades || tomados.some(t => t.costo_unitario == null)) return null;
    return Math.round(tomados.reduce((s, t) => s + t.cantidad * Number(t.costo_unitario), 0) / unidades * 10000) / 10000;
};

/** costo: undefined = el de ahora (receta o última compra); null o número = ese (copias de una transferencia) */
const insertar = (client, { id_inventario, id_historial, cantidad, fecha_ingreso = null, vence = null, costo = undefined }) =>
    client.query(`
        INSERT INTO lote_inventario (id_inventario, id_historial, fecha_ingreso, fecha_vencimiento, cantidad_inicial, cantidad_actual,
                                     costo_unitario)
        VALUES ($1, $2, COALESCE($3::timestamp, LOCALTIMESTAMP), COALESCE($4::timestamp, (${VENCE})), $5, $5,
                ${costo === undefined
                    ? `(SELECT ${COSTO_DE_PRODUCTO()} FROM inventario_sucursal i JOIN producto p ON p.id_producto = i.id_producto
                        WHERE i.id_inventario = $1)`
                    : '$6::numeric'})
        RETURNING id_lote`,
        costo === undefined ? [id_inventario, id_historial, fecha_ingreso, vence, cantidad]
                            : [id_inventario, id_historial, fecha_ingreso, vence, cantidad, costo]);

const anotar = (client, id_historial, movimientos) => {
    if (!id_historial || !movimientos.length) return null;
    return client.query(`
        INSERT INTO movimiento_lote (id_historial, id_lote, cantidad)
        SELECT $1, t.id, t.c FROM unnest($2::int[], $3::int[]) AS t(id, c)`,
        [id_historial, movimientos.map(m => m.id_lote), movimientos.map(m => m.cantidad)]);
};

/** Salida PEPS. lotes: ids a los que se limita (dar de baja vencidos). Devuelve lo que sacó de cada lote. */
const consumir = async (client, { id_inventario, id_historial, cantidad, lotes = null }) => {
    const r = await client.query(`
        SELECT id_lote, cantidad_actual, fecha_ingreso, fecha_vencimiento, costo_unitario
        FROM lote_inventario
        WHERE id_inventario = $1 AND cantidad_actual > 0 AND ($2::int[] IS NULL OR id_lote = ANY($2))
        ORDER BY fecha_ingreso, id_lote`, [id_inventario, lotes]);
    const tomados = [];
    let resta = cantidad;
    for (const l of r.rows) {
        if (resta <= 0) break;
        const t = Math.min(resta, l.cantidad_actual);
        tomados.push({ id_lote: l.id_lote, cantidad: t, fecha_ingreso: l.fecha_ingreso, fecha_vencimiento: l.fecha_vencimiento,
                       costo_unitario: l.costo_unitario });
        resta -= t;
    }
    if (tomados.length) {
        await client.query(`
            UPDATE lote_inventario l SET cantidad_actual = l.cantidad_actual - t.c
            FROM unnest($1::int[], $2::int[]) AS t(id, c) WHERE l.id_lote = t.id`,
            [tomados.map(t => t.id_lote), tomados.map(t => t.cantidad)]);
        await anotar(client, id_historial, tomados.map(t => ({ id_lote: t.id_lote, cantidad: -t.cantidad })));
    }
    return { tomados, faltan: resta };
};

/**
 * Ingreso: un lote nuevo, o copias de los lotes que salieron de otra sucursal (transferencia: misma fecha,
 * vencimiento y costo). costo: el que se pagó (compra); sin él, el de ahora.
 */
const ingresar = async (client, { id_inventario, id_historial, cantidad, vence = null, desde = null, costo = undefined }) => {
    const partes = desde?.length ? desde
                 : [{ cantidad, fecha_ingreso: null, fecha_vencimiento: vence, costo_unitario: costo ?? undefined }];
    const movimientos = [];
    for (const p of partes) {
        const r = await insertar(client, { id_inventario, id_historial, cantidad: p.cantidad, costo: p.costo_unitario,
                                           fecha_ingreso: p.fecha_ingreso, vence: p.fecha_vencimiento });
        movimientos.push({ id_lote: r.rows[0].id_lote, cantidad: p.cantidad });
    }
    await anotar(client, id_historial, movimientos);
};

/**
 * Devolución: vuelve a los lotes de los que salió esa referencia (pedido o línea de la cuenta),
 * del último al primero. Lo que no se encuentre (datos de antes de los lotes) va al lote más
 * reciente con lugar y, si no hay, a uno nuevo.
 */
const devolver = async (client, { id_inventario, id_historial, cantidad, referencia = {} }) => {
    const { id_pedido = null, id_detalle_cuenta = null } = referencia;
    const destinos = [];
    let resta = cantidad;
    if (id_pedido || id_detalle_cuenta) {
        const r = await client.query(`
            SELECT ml.id_lote, -SUM(ml.cantidad)::int AS pendiente
            FROM movimiento_lote ml
            JOIN historial_inventario h ON h.id_historial = ml.id_historial
            JOIN lote_inventario l      ON l.id_lote      = ml.id_lote
            WHERE h.id_inventario = $1 AND (h.id_pedido = $2 OR h.id_detalle_cuenta = $3)
            GROUP BY ml.id_lote, l.fecha_ingreso
            HAVING SUM(ml.cantidad) < 0
            ORDER BY l.fecha_ingreso DESC, ml.id_lote DESC`, [id_inventario, id_pedido, id_detalle_cuenta]);
        for (const l of r.rows) {
            if (resta <= 0) break;
            const t = Math.min(resta, l.pendiente);
            destinos.push({ id_lote: l.id_lote, cantidad: t });
            resta -= t;
        }
    }
    if (resta > 0) {
        const r = await client.query(`
            SELECT id_lote, cantidad_inicial - cantidad_actual AS lugar
            FROM lote_inventario
            WHERE id_inventario = $1 AND cantidad_actual < cantidad_inicial AND id_lote <> ALL($2::int[])
            ORDER BY fecha_ingreso DESC, id_lote DESC`, [id_inventario, destinos.map(d => d.id_lote)]);
        for (const l of r.rows) {
            if (resta <= 0) break;
            const t = Math.min(resta, l.lugar);
            destinos.push({ id_lote: l.id_lote, cantidad: t });
            resta -= t;
        }
    }
    if (destinos.length) {
        await client.query(`
            UPDATE lote_inventario l SET cantidad_actual = l.cantidad_actual + t.c
            FROM unnest($1::int[], $2::int[]) AS t(id, c) WHERE l.id_lote = t.id`,
            [destinos.map(d => d.id_lote), destinos.map(d => d.cantidad)]);
        await anotar(client, id_historial, destinos);
    }
    if (resta > 0) await ingresar(client, { id_inventario, id_historial, cantidad: resta });
};

/**
 * La suma de los lotes debe ser igual al stock. Si no lo es (un cambio hecho a mano en la BD),
 * se corrige sin detener la operación: lo que falta va a un lote nuevo y lo que sobra sale de los más antiguos.
 * Devuelve la diferencia corregida (0 = estaba bien).
 */
const cuadrar = async (client, id_inventario) => {
    const r = await client.query(`
        SELECT i.cantidad_actual, p.tipo_producto,
               COALESCE((SELECT SUM(cantidad_actual) FROM lote_inventario WHERE id_inventario = i.id_inventario), 0)::int AS en_lotes
        FROM inventario_sucursal i JOIN producto p ON p.id_producto = i.id_producto
        WHERE i.id_inventario = $1`, [id_inventario]);
    if (!r.rows.length) return 0;
    const { cantidad_actual, tipo_producto, en_lotes } = r.rows[0];
    const esperado = tipo_producto === 'PREPARADO' ? 0 : Number(cantidad_actual);
    const diferencia = esperado - en_lotes;
    if (diferencia > 0) await insertar(client, { id_inventario, id_historial: null, cantidad: diferencia });
    if (diferencia < 0) await consumir(client, { id_inventario, id_historial: null, cantidad: -diferencia });
    if (diferencia) console.warn(`[lotes] inventario ${id_inventario}: lotes corregidos en ${diferencia > 0 ? '+' : ''}${diferencia}`);
    return diferencia;
};

/** Revisa todas las filas (al arrancar y en el cierre del día) */
const cuadrarTodos = async (db) => {
    const r = await db.query(`
        SELECT i.id_inventario
        FROM inventario_sucursal i
        JOIN producto p ON p.id_producto = i.id_producto
        LEFT JOIN (SELECT id_inventario, SUM(cantidad_actual)::int AS s FROM lote_inventario GROUP BY id_inventario) l
               ON l.id_inventario = i.id_inventario
        WHERE CASE WHEN p.tipo_producto = 'PREPARADO' THEN 0 ELSE i.cantidad_actual END <> COALESCE(l.s, 0)`);
    let corregidos = 0;
    for (const { id_inventario } of r.rows) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SELECT 1 FROM inventario_sucursal WHERE id_inventario = $1 FOR UPDATE`, [id_inventario]);
            if (await cuadrar(client, id_inventario)) corregidos++;
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`[lotes] no se pudo revisar el inventario ${id_inventario}:`, e.message);
        } finally {
            client.release();
        }
    }
    return corregidos;
};

/**
 * Costo por unidad de lo que tiene reservado una línea de mesa: lo que salió de los lotes con su
 * referencia (la línea o el pedido QR del que vino), menos lo devuelto. null si no se puede saber.
 */
const costoReservado = async (client, { id_producto, id_detalle_cuenta, id_pedido = null }) => {
    const r = await client.query(`
        SELECT ml.id_lote, -SUM(ml.cantidad)::int AS cantidad, l.costo_unitario
        FROM movimiento_lote ml
        JOIN historial_inventario h ON h.id_historial  = ml.id_historial
        JOIN inventario_sucursal i  ON i.id_inventario = h.id_inventario
        JOIN lote_inventario l      ON l.id_lote       = ml.id_lote
        WHERE i.id_producto = $1 AND (h.id_detalle_cuenta = $2 OR h.id_pedido = $3)
        GROUP BY ml.id_lote, l.costo_unitario
        HAVING SUM(ml.cantidad) < 0`, [id_producto, id_detalle_cuenta, id_pedido]);
    return { unidades: r.rows.reduce((s, l) => s + l.cantidad, 0), costo: costoDeLotes(r.rows) };
};

// ─── Vencimientos ───
// «Por vencer» = vence dentro del aviso de Ajustes (horas para lo elaborado, días para lo comprado).
// p = producto, c = configuracion, l = lote
const AVISO = (p = 'p', c = 'c') => `(CASE ${p}.tipo_producto WHEN 'COMPRADO' THEN make_interval(days => ${c}.aviso_vence_comprado_dias)
                                          ELSE make_interval(hours => ${c}.aviso_vence_elaborado_horas) END)`;
const ESTADO = (l = 'l', p = 'p', c = 'c') => `(CASE WHEN ${l}.fecha_vencimiento <= LOCALTIMESTAMP THEN 'VENCIDO'
                                                     WHEN ${l}.fecha_vencimiento <= LOCALTIMESTAMP + ${AVISO(p, c)} THEN 'POR_VENCER'
                                                     ELSE 'VIGENTE' END)`;
// El aviso más largo de los dos: deja usar el índice por fecha de vencimiento
const HORIZONTE = `LOCALTIMESTAMP + (SELECT GREATEST(make_interval(days => aviso_vence_comprado_dias),
                                                     make_interval(hours => aviso_vence_elaborado_horas))
                                     FROM configuracion WHERE id_configuracion = 1)`;

/** Lotes con stock vencidos o por vencer de una sucursal, del que vence antes al último */
const listarVencimientos = async (db, id_sucursal) => (await db.query(`
    SELECT l.id_lote, l.cantidad_actual AS cantidad, l.fecha_ingreso, l.fecha_vencimiento, ${ESTADO()} AS estado,
           p.id_producto, p.nombre_producto, p.tipo_producto, cat.nombre_categoria
    FROM lote_inventario l
    JOIN inventario_sucursal i     ON i.id_inventario = l.id_inventario
    JOIN producto p                ON p.id_producto   = i.id_producto
    LEFT JOIN categoria_producto cat ON cat.id_categoria = p.id_categoria
    CROSS JOIN configuracion c
    WHERE i.id_sucursal = $1 AND c.id_configuracion = 1 AND l.cantidad_actual > 0
      AND p.tipo_producto <> 'PREPARADO' AND l.fecha_vencimiento <= LOCALTIMESTAMP + ${AVISO()}
    ORDER BY l.fecha_vencimiento, p.nombre_producto, l.id_lote`, [id_sucursal])).rows;

/**
 * Lotes que pasaron a «por vencer» o «vencido» desde la última revisión.
 * Devuelve [{ id_sucursal, nombre_sucursal, nivel (1 por vencer, 2 vencido), lotes, productos: [{ nombre, cantidad }] }]
 */
const nuevosVencimientos = async (db) => {
    const r = await db.query(`
        SELECT * FROM (
            SELECT l.id_lote, l.aviso, l.cantidad_actual, i.id_sucursal, s.nombre_sucursal, p.nombre_producto,
                   CASE ${ESTADO()} WHEN 'VENCIDO' THEN 2 WHEN 'POR_VENCER' THEN 1 ELSE 0 END AS nivel
            FROM lote_inventario l
            JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
            JOIN producto p            ON p.id_producto   = i.id_producto
            JOIN sucursal s            ON s.id_sucursal   = i.id_sucursal
            CROSS JOIN configuracion c
            WHERE c.id_configuracion = 1 AND l.cantidad_actual > 0 AND l.fecha_vencimiento <= ${HORIZONTE}
              AND p.tipo_producto <> 'PREPARADO'
        ) x
        WHERE nivel > aviso
        ORDER BY id_sucursal, nivel, nombre_producto`);
    const grupos = new Map();
    for (const f of r.rows) {
        const clave = `${f.id_sucursal}-${f.nivel}`;
        const g = grupos.get(clave) ?? { id_sucursal: f.id_sucursal, nombre_sucursal: f.nombre_sucursal, nivel: f.nivel,
                                         lotes: [], porProducto: new Map() };
        g.lotes.push(f.id_lote);
        g.porProducto.set(f.nombre_producto, (g.porProducto.get(f.nombre_producto) || 0) + f.cantidad_actual);
        grupos.set(clave, g);
    }
    return [...grupos.values()].map(({ porProducto, ...g }) => ({
        ...g, productos: [...porProducto].map(([nombre, cantidad]) => ({ nombre, cantidad }))
    }));
};

module.exports = { consumir, ingresar, devolver, cuadrar, cuadrarTodos, AVISO, ESTADO, listarVencimientos, nuevosVencimientos,
                   COSTO_DE_PRODUCTO, costoActual, costoDeLotes, costoReservado };
