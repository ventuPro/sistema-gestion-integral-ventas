const db = require('../config/db');

// ─── Costos de producción: insumos (lo que se compra) y recetas (lo que se prepara) ───
// Todo se calcula en NUMERIC. El costo por g / ml / unidad no se guarda: sale del precio de compra.
// La inversión de cada receta sí se guarda (con su historial) y se recalcula al cambiar la receta
// o el precio de un insumo que usa.

const error = (codigo, message) => Object.assign(new Error(message), { codigo });

/** Costo de una unidad base (g, ml o unidad) del insumo i (uc = unidad de compra) */
const COSTO_BASE = `i.precio_compra / (i.cantidad_compra * uc.factor_base)`;

const unidades = async () => (await db.query(
    `SELECT id_unidad, codigo, nombre, tipo, factor_base::float8 AS factor_base FROM unidad_medida ORDER BY orden`)).rows;

// ─── Insumos ───

const listarInsumos = async () => (await db.query(`
    SELECT i.id_insumo, i.nombre, i.cantidad_compra::float8 AS cantidad_compra, i.id_unidad_compra,
           uc.codigo AS unidad_compra, uc.tipo, i.precio_compra::float8 AS precio_compra, i.fecha_precio,
           (${COSTO_BASE})::float8 AS costo_base,
           (SELECT COUNT(*)::int FROM ingrediente_receta ir WHERE ir.id_insumo = i.id_insumo) AS recetas
    FROM insumo i JOIN unidad_medida uc ON uc.id_unidad = i.id_unidad_compra
    ORDER BY i.nombre`)).rows;

const unidadDe = async (client, id_unidad) => {
    const r = await client.query(`SELECT id_unidad, codigo, tipo FROM unidad_medida WHERE id_unidad = $1`, [id_unidad]);
    if (!r.rows.length) throw error('INVALIDO', 'Unidad de medida inválida');
    return r.rows[0];
};

const registrarPrecio = (client, id_insumo, id_usuario) => client.query(`
    INSERT INTO historial_precio_insumo (id_insumo, cantidad_compra, id_unidad_compra, precio_compra, id_usuario)
    SELECT id_insumo, cantidad_compra, id_unidad_compra, precio_compra, $2 FROM insumo WHERE id_insumo = $1
`, [id_insumo, id_usuario || null]);

const enTransaccion = async (fn) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
    } catch (e) {
        await client.query('ROLLBACK');
        if (e.code === '23505') throw error('DUPLICADO', 'Ya existe uno con ese nombre');
        throw e;
    } finally {
        client.release();
    }
};

const crearInsumo = ({ nombre, cantidad_compra, id_unidad_compra, precio_compra }, id_usuario) =>
    enTransaccion(async (client) => {
        await unidadDe(client, id_unidad_compra);
        const r = await client.query(`
            INSERT INTO insumo (nombre, cantidad_compra, id_unidad_compra, precio_compra)
            VALUES ($1, $2, $3, $4) RETURNING id_insumo`, [nombre, cantidad_compra, id_unidad_compra, precio_compra]);
        await registrarPrecio(client, r.rows[0].id_insumo, id_usuario);
        return r.rows[0];
    });

/** Cambia nombre, presentación o precio; si cambia el costo, recalcula las recetas que lo usan */
const actualizarInsumo = (id_insumo, datos, id_usuario) =>
    enTransaccion(async (client) => {
        const rAntes = await client.query(`
            SELECT i.*, uc.codigo AS unidad, uc.tipo FROM insumo i JOIN unidad_medida uc ON uc.id_unidad = i.id_unidad_compra
            WHERE i.id_insumo = $1 FOR UPDATE OF i`, [id_insumo]);
        if (!rAntes.rows.length) throw error('NO_EXISTE', 'Insumo no encontrado');
        const antes = rAntes.rows[0];
        const nuevo = { ...antes, ...datos };
        const unidad = await unidadDe(client, nuevo.id_unidad_compra);
        // Las recetas guardan sus cantidades en unidades de su tipo: no se puede pasar de peso a volumen
        if (unidad.tipo !== antes.tipo) {
            const usado = await client.query(`SELECT 1 FROM ingrediente_receta WHERE id_insumo = $1 LIMIT 1`, [id_insumo]);
            if (usado.rows.length) throw error('INVALIDO', 'El insumo ya está en recetas: su unidad debe ser del mismo tipo');
        }
        await client.query(`
            UPDATE insumo SET nombre = $2, cantidad_compra = $3, id_unidad_compra = $4, precio_compra = $5,
                   fecha_precio = CASE WHEN precio_compra <> $5 OR cantidad_compra <> $3 OR id_unidad_compra <> $4
                                       THEN NOW() ELSE fecha_precio END
            WHERE id_insumo = $1`, [id_insumo, nuevo.nombre, nuevo.cantidad_compra, nuevo.id_unidad_compra, nuevo.precio_compra]);

        const cambioCosto = Number(antes.precio_compra) !== Number(nuevo.precio_compra)
            || Number(antes.cantidad_compra) !== Number(nuevo.cantidad_compra)
            || Number(antes.id_unidad_compra) !== Number(nuevo.id_unidad_compra);
        let recetas = [];
        if (cambioCosto) {
            await registrarPrecio(client, id_insumo, id_usuario);
            const ids = (await client.query(`SELECT id_receta FROM ingrediente_receta WHERE id_insumo = $1`, [id_insumo]))
                .rows.map(r => r.id_receta);
            const presentacion = (c, u) => `${Number(c).toLocaleString('es-BO')} ${u}`;
            const motivo = `${nuevo.nombre}: Bs ${Number(antes.precio_compra).toFixed(2)} (${presentacion(antes.cantidad_compra, antes.unidad)})`
                         + ` → Bs ${Number(nuevo.precio_compra).toFixed(2)} (${presentacion(nuevo.cantidad_compra, unidad.codigo)})`;
            recetas = await recalcular(client, ids, motivo, id_usuario);
        }
        return { recetas_actualizadas: recetas.length };
    });

/** Solo si no está en ninguna receta */
const eliminarInsumo = (id_insumo) =>
    enTransaccion(async (client) => {
        const usado = await client.query(`
            SELECT string_agg(r.nombre, ', ' ORDER BY r.nombre) AS recetas FROM ingrediente_receta ir
            JOIN receta r USING (id_receta) WHERE ir.id_insumo = $1`, [id_insumo]);
        if (usado.rows[0].recetas) throw error('EN_USO', `Está en: ${usado.rows[0].recetas}. Quítalo de esas recetas primero.`);
        const r = await client.query(`DELETE FROM insumo WHERE id_insumo = $1 RETURNING id_insumo`, [id_insumo]);
        if (!r.rows.length) throw error('NO_EXISTE', 'Insumo no encontrado');
    });

const historialInsumo = async (id_insumo) => (await db.query(`
    SELECT h.fecha, h.cantidad_compra::float8 AS cantidad_compra, u.codigo AS unidad, h.precio_compra::float8 AS precio_compra,
           us.nombre_completo AS usuario
    FROM historial_precio_insumo h
    JOIN unidad_medida u ON u.id_unidad = h.id_unidad_compra
    LEFT JOIN usuario us ON us.id_usuario = h.id_usuario
    WHERE h.id_insumo = $1 ORDER BY h.fecha DESC, h.id_historial DESC`, [id_insumo])).rows;

// ─── Recetas ───

/**
 * Vuelve a calcular la inversión de las recetas con los precios actuales; guarda e historia las que cambiaron.
 * siempre: también deja historial si no cambió (al crear o editar la receta).
 */
const recalcular = async (client, ids, motivo, id_usuario, siempre = false) => {
    if (!ids.length) return [];
    return (await client.query(`
        WITH nuevo AS (
            SELECT r.id_receta,
                   ROUND(COALESCE(SUM(ir.cantidad * u.factor_base * ${COSTO_BASE}), 0), 4) AS inversion
            FROM receta r
            LEFT JOIN ingrediente_receta ir ON ir.id_receta = r.id_receta
            LEFT JOIN unidad_medida u  ON u.id_unidad  = ir.id_unidad
            LEFT JOIN insumo i         ON i.id_insumo  = ir.id_insumo
            LEFT JOIN unidad_medida uc ON uc.id_unidad = i.id_unidad_compra
            WHERE r.id_receta = ANY($1::int[])
            GROUP BY r.id_receta
        ), cambio AS (
            UPDATE receta r SET inversion = n.inversion, fecha_calculo = NOW()
            FROM nuevo n
            WHERE r.id_receta = n.id_receta AND ($4 OR r.inversion IS DISTINCT FROM n.inversion)
            RETURNING r.id_receta, r.inversion, r.rendimiento
        )
        INSERT INTO historial_inversion_receta (id_receta, inversion, rendimiento, motivo, id_usuario)
        SELECT id_receta, inversion, rendimiento, $2, $3 FROM cambio
        RETURNING id_receta
    `, [ids, motivo, id_usuario || null, siempre])).rows;
};

const listarRecetas = async () => (await db.query(`
    SELECT r.id_receta, r.nombre, r.rendimiento::float8 AS rendimiento, r.inversion::float8 AS inversion,
           ROUND(r.inversion / r.rendimiento, 4)::float8 AS por_unidad, r.fecha_calculo,
           (SELECT COUNT(*)::int FROM ingrediente_receta ir WHERE ir.id_receta = r.id_receta) AS ingredientes
    FROM receta r ORDER BY r.nombre`)).rows;

const obtenerReceta = async (id_receta) => {
    const r = await db.query(`
        SELECT id_receta, nombre, rendimiento::float8 AS rendimiento, inversion::float8 AS inversion,
               ROUND(inversion / rendimiento, 4)::float8 AS por_unidad, fecha_calculo
        FROM receta WHERE id_receta = $1`, [id_receta]);
    if (!r.rows.length) return null;
    const ingredientes = (await db.query(`
        SELECT ir.id_insumo, i.nombre, ir.cantidad::float8 AS cantidad, ir.id_unidad, u.codigo AS unidad,
               ROUND(ir.cantidad * u.factor_base * ${COSTO_BASE}, 4)::float8 AS costo
        FROM ingrediente_receta ir
        JOIN insumo i         ON i.id_insumo  = ir.id_insumo
        JOIN unidad_medida u  ON u.id_unidad  = ir.id_unidad
        JOIN unidad_medida uc ON uc.id_unidad = i.id_unidad_compra
        WHERE ir.id_receta = $1 ORDER BY i.nombre`, [id_receta])).rows;
    return { ...r.rows[0], ingredientes };
};

/** Crea (id_receta null) o reemplaza la receta con sus ingredientes y guarda su inversión */
const guardarReceta = (id_receta, { nombre, rendimiento, ingredientes }, id_usuario) =>
    enTransaccion(async (client) => {
        // Cada ingrediente en una unidad del mismo tipo que su insumo
        const ids = ingredientes.map(x => x.id_insumo);
        const tipos = await client.query(`
            SELECT i.id_insumo, i.nombre, uc.tipo FROM insumo i JOIN unidad_medida uc ON uc.id_unidad = i.id_unidad_compra
            WHERE i.id_insumo = ANY($1::int[])`, [ids]);
        const tipoDe = new Map(tipos.rows.map(t => [t.id_insumo, t]));
        for (const x of ingredientes) {
            const ins = tipoDe.get(x.id_insumo);
            if (!ins) throw error('INVALIDO', 'Un insumo de la receta ya no existe');
            const u = await unidadDe(client, x.id_unidad);
            if (u.tipo !== ins.tipo) throw error('INVALIDO', `${ins.nombre} no se mide en ${u.codigo}`);
        }

        let id = id_receta;
        if (id) {
            const r = await client.query(`UPDATE receta SET nombre = $2, rendimiento = $3 WHERE id_receta = $1 RETURNING id_receta`,
                                         [id, nombre, rendimiento]);
            if (!r.rows.length) throw error('NO_EXISTE', 'Receta no encontrada');
            await client.query(`DELETE FROM ingrediente_receta WHERE id_receta = $1`, [id]);
        } else {
            id = (await client.query(`INSERT INTO receta (nombre, rendimiento) VALUES ($1, $2) RETURNING id_receta`,
                                     [nombre, rendimiento])).rows[0].id_receta;
        }
        for (const x of ingredientes) {
            await client.query(`INSERT INTO ingrediente_receta (id_receta, id_insumo, cantidad, id_unidad) VALUES ($1, $2, $3, $4)`,
                               [id, x.id_insumo, x.cantidad, x.id_unidad]);
        }
        await recalcular(client, [id], id_receta ? 'Receta editada' : 'Receta creada', id_usuario, true);
        return { id_receta: id };
    });

const eliminarReceta = async (id_receta) => {
    const r = await db.query(`DELETE FROM receta WHERE id_receta = $1 RETURNING id_receta`, [id_receta]);
    if (!r.rows.length) throw error('NO_EXISTE', 'Receta no encontrada');
};

const historialReceta = async (id_receta) => (await db.query(`
    SELECT h.fecha, h.motivo, h.inversion::float8 AS inversion, h.rendimiento::float8 AS rendimiento,
           ROUND(h.inversion / h.rendimiento, 4)::float8 AS por_unidad, u.nombre_completo AS usuario
    FROM historial_inversion_receta h LEFT JOIN usuario u ON u.id_usuario = h.id_usuario
    WHERE h.id_receta = $1 ORDER BY h.fecha DESC, h.id_historial DESC`, [id_receta])).rows;

module.exports = {
    unidades, listarInsumos, crearInsumo, actualizarInsumo, eliminarInsumo, historialInsumo,
    listarRecetas, obtenerReceta, guardarReceta, eliminarReceta, historialReceta
};
