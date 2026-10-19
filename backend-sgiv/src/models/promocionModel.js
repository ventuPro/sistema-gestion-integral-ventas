const db = require('../config/db');

// ─── Promociones ───
// PORCENTAJE (valor = %), PRECIO (valor = precio especial por unidad),
// NXM (lleva N y paga M) y COMBO (valor = precio del combo; productos con cantidad).
// Se aplican solas al cobrar y siempre gana lo que más ahorra al cliente.
// Todo se calcula en centavos.
const TIPOS = ['PORCENTAJE', 'PRECIO', 'NXM', 'COMBO'];

const errorCodigo = (codigo, mensaje) => Object.assign(new Error(mensaje), { code: codigo });

/** Reparte un monto entero en proporción a los pesos; el resto va a los de mayor peso */
const repartir = (total, pesos) => {
    const suma = pesos.reduce((s, p) => s + p, 0);
    if (!pesos.length) return [];
    if (!suma) return pesos.map((_, i) => (i === 0 ? total : 0));
    const partes = pesos.map(p => Math.floor(total * p / suma));
    let resto = total - partes.reduce((s, p) => s + p, 0);
    const orden = pesos.map((_, i) => i).sort((a, b) => pesos[b] - pesos[a]);
    for (let j = 0; resto > 0; j = (j + 1) % orden.length, resto--) partes[orden[j]]++;
    return partes;
};

/** Ahorro de una promoción simple sobre q unidades de precio u */
const descuentoSimple = (promo, q, u) => {
    if (promo.tipo === 'PORCENTAJE') return Math.round(q * u * Number(promo.valor) / 100);
    if (promo.tipo === 'PRECIO')     return Math.max(0, u - Math.round(Number(promo.valor) * 100)) * q;
    if (promo.tipo === 'NXM')        return Math.floor(q / promo.lleva) * (promo.lleva - promo.paga) * u;
    return 0;
};

// ─── Motor de precios ───
// lineas: [{ id_producto, id_categoria, cantidad, precioCentavos }]
// promos: [{ id_promocion, nombre, tipo, valor, lleva, paga, productos: [{ id_producto, cantidad }], categorias: [id] }]
// Devuelve las líneas con descuentoPromoCentavos, id_promocion y promociones (nombres).
const aplicarPromociones = (lineas, promos) => {
    const resultado = lineas.map(l => ({
        ...l, brutoCentavos: l.precioCentavos * l.cantidad, descuentoPromoCentavos: 0, id_promocion: null, promociones: []
    }));

    // Un mismo producto puede venir en varias líneas (mesas): se evalúa junto
    const grupos = new Map();
    for (const l of resultado) {
        const g = grupos.get(l.id_producto) ?? { id_producto: l.id_producto, id_categoria: l.id_categoria, cantidad: 0, bruto: 0, lineas: [] };
        g.cantidad += l.cantidad;
        g.bruto += l.brutoCentavos;
        g.lineas.push(l);
        grupos.set(l.id_producto, g);
    }
    for (const g of grupos.values()) g.precio = Math.round(g.bruto / g.cantidad);

    const cubre = (p, g) => p.productos.some(x => x.id_producto === g.id_producto) || p.categorias.includes(g.id_categoria);
    const simples = promos.filter(p => p.tipo !== 'COMBO');
    const mejorSimple = (g, q) => {
        let mejor = { centavos: 0, promo: null };
        for (const p of simples) {
            if (!cubre(p, g)) continue;
            const c = Math.min(descuentoSimple(p, q, g.precio), q * g.precio);
            if (c > mejor.centavos) mejor = { centavos: c, promo: p };
        }
        return mejor;
    };

    const libres = new Map([...grupos.values()].map(g => [g.id_producto, g.cantidad]));
    const aplicadas = new Map();   // id_producto → [{ centavos, promo }]
    const anotar = (id, centavos, promo) => {
        if (centavos > 0) aplicadas.set(id, [...(aplicadas.get(id) || []), { centavos, promo }]);
    };

    // Combos primero, solo si ahorran más que las promociones simples sobre esas mismas unidades
    const combos = promos
        .filter(p => p.tipo === 'COMBO' && p.productos.length && p.productos.every(c => grupos.has(c.id_producto)))
        .map(p => {
            const normal = p.productos.reduce((s, c) => s + c.cantidad * grupos.get(c.id_producto).precio, 0);
            return { p, ahorro: normal - Math.round(Number(p.valor) * 100) };
        })
        .filter(c => c.ahorro > 0)
        .sort((a, b) => b.ahorro - a.ahorro);

    for (const { p, ahorro } of combos) {
        let k = Math.min(...p.productos.map(c => Math.floor(libres.get(c.id_producto) / c.cantidad)));
        for (; k > 0; k--) {
            const perdida = p.productos.reduce((s, c) => {
                const g = grupos.get(c.id_producto), q = libres.get(c.id_producto);
                return s + mejorSimple(g, q).centavos - mejorSimple(g, q - k * c.cantidad).centavos;
            }, 0);
            if (k * ahorro > perdida) break;
        }
        if (!k) continue;
        const partes = repartir(k * ahorro, p.productos.map(c => c.cantidad * grupos.get(c.id_producto).precio));
        p.productos.forEach((c, i) => {
            libres.set(c.id_producto, libres.get(c.id_producto) - k * c.cantidad);
            anotar(c.id_producto, partes[i], p);
        });
    }

    // Las unidades que quedan: la mejor promoción simple
    for (const g of grupos.values()) {
        const m = mejorSimple(g, libres.get(g.id_producto));
        anotar(g.id_producto, m.centavos, m.promo);
    }

    // Cada grupo reparte su ahorro entre sus líneas según el importe
    for (const g of grupos.values()) {
        const lista = aplicadas.get(g.id_producto);
        if (!lista) continue;
        const total = Math.min(lista.reduce((s, a) => s + a.centavos, 0), g.bruto);
        const principal = lista.reduce((a, b) => (b.centavos > a.centavos ? b : a));
        const partes = repartir(total, g.lineas.map(l => l.brutoCentavos));
        g.lineas.forEach((l, i) => {
            l.descuentoPromoCentavos = partes[i];
            l.id_promocion = principal.promo.id_promocion;
            l.promociones = [...new Set(lista.map(a => a.promo.nombre))];
        });
    }
    return resultado;
};

// ─── Descuento manual del cajero ───
// descuento: { tipo: 'PORCENTAJE' | 'MONTO', valor, motivo }; sin tope: nunca más que el total
const descuentoManual = (totalCentavos, descuento) => {
    if (!descuento || !Number(descuento.valor)) return { centavos: 0, motivo: null };
    const valor  = Number(descuento.valor);
    const motivo = String(descuento.motivo || '').replace(/\s+/g, ' ').trim();
    const invalido = (m) => errorCodigo('DESCUENTO_INVALIDO', m);
    if (!['PORCENTAJE', 'MONTO'].includes(descuento.tipo)) throw invalido('Tipo de descuento inválido.');
    if (!Number.isFinite(valor) || valor < 0) throw invalido('El descuento debe ser un número positivo.');
    if (motivo.length < 3) throw invalido('Indica el motivo del descuento.');
    if (motivo.length > 120) throw invalido('El motivo admite hasta 120 caracteres.');
    const centavos = descuento.tipo === 'PORCENTAJE' ? Math.round(totalCentavos * valor / 100) : Math.round(valor * 100);
    if (centavos > totalCentavos) throw invalido('El descuento no puede superar el total de la venta.');
    return { centavos, motivo };
};

// ─── Vigentes ahora (la sesión de BD usa la hora de La Paz) ───
const CONDICION_VIGENTE = `
    p.estado_activo
    AND CURRENT_DATE BETWEEN p.fecha_inicio AND p.fecha_fin
    AND (p.dias_semana IS NULL OR EXTRACT(ISODOW FROM NOW())::int = ANY(p.dias_semana))
    AND (p.hora_inicio IS NULL OR CASE WHEN p.hora_inicio <= p.hora_fin
            THEN LOCALTIME BETWEEN p.hora_inicio AND p.hora_fin
            ELSE LOCALTIME >= p.hora_inicio OR LOCALTIME <= p.hora_fin END)`;

const vigentes = async (client, id_sucursal) => {
    const r = await client.query(`
        SELECT p.id_promocion, p.nombre, p.tipo, p.valor::float8 AS valor, p.lleva, p.paga,
               COALESCE((SELECT json_agg(json_build_object('id_producto', pp.id_producto, 'cantidad', pp.cantidad))
                         FROM promocion_producto pp WHERE pp.id_promocion = p.id_promocion), '[]') AS productos,
               COALESCE((SELECT array_agg(pc.id_categoria)
                         FROM promocion_categoria pc WHERE pc.id_promocion = p.id_promocion), '{}') AS categorias
        FROM promocion p
        WHERE (p.id_sucursal IS NULL OR p.id_sucursal = $1) AND ${CONDICION_VIGENTE}
    `, [id_sucursal]);
    return r.rows;
};

/** Vigentes con nombres de productos y categorías (menú QR y asistentes) */
const vigentesDetalle = async (id_sucursal) => {
    const r = await db.query(`
        SELECT p.id_promocion, p.nombre, p.tipo, p.valor::float8 AS valor, p.lleva, p.paga,
               to_char(p.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(p.hora_fin, 'HH24:MI') AS hora_fin,
               to_char(p.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
               COALESCE((SELECT json_agg(json_build_object('id_producto', pp.id_producto, 'cantidad', pp.cantidad,
                                                           'nombre_producto', pr.nombre_producto) ORDER BY pr.nombre_producto)
                         FROM promocion_producto pp JOIN producto pr ON pr.id_producto = pp.id_producto
                         WHERE pp.id_promocion = p.id_promocion), '[]') AS productos,
               COALESCE((SELECT json_agg(json_build_object('id_categoria', c.id_categoria, 'nombre_categoria', c.nombre_categoria))
                         FROM promocion_categoria pc JOIN categoria_producto c ON c.id_categoria = pc.id_categoria
                         WHERE pc.id_promocion = p.id_promocion), '[]') AS categorias
        FROM promocion p
        WHERE (p.id_sucursal IS NULL OR p.id_sucursal = $1) AND ${CONDICION_VIGENTE}
        ORDER BY p.nombre
    `, [id_sucursal]);
    return r.rows;
};

/** «−20 % en Tortas, Queques (18:00 a 21:00)» */
const textoPromocion = (v, moneda) => {
    const que = [...v.categorias.map(c => c.nombre_categoria),
                 ...v.productos.map(x => (v.tipo === 'COMBO' && x.cantidad > 1 ? `${x.cantidad} ` : '') + x.nombre_producto)].join(', ');
    const tipo = v.tipo === 'PORCENTAJE' ? `−${v.valor} % en ${que}`
               : v.tipo === 'PRECIO'     ? `${que} a ${moneda} ${v.valor.toFixed(2)} c/u`
               : v.tipo === 'NXM'        ? `lleva ${v.lleva} y paga ${v.paga} en ${que}`
               :                           `combo ${que} a ${moneda} ${v.valor.toFixed(2)}`;
    return `${v.nombre}: ${tipo}${v.hora_inicio ? ` (${v.hora_inicio} a ${v.hora_fin})` : ''}`;
};

/** La promoción que se muestra en un producto del catálogo; precio_promocional solo si baja el precio por unidad */
const promocionDeProducto = (prod, vigentes) => {
    const precio = Math.round(Number(prod.precio_unitario) * 100);
    const aplica = vigentes.filter(v => v.productos.some(x => x.id_producto === prod.id_producto) ||
                                        v.categorias.some(c => c.id_categoria === prod.id_categoria));
    if (!aplica.length) return null;
    const unidad = (v) => v.tipo === 'PORCENTAJE' ? Math.round(precio * (100 - v.valor) / 100)
                        : v.tipo === 'PRECIO'     ? Math.min(precio, Math.round(v.valor * 100)) : null;
    const rebajas = aplica.filter(v => unidad(v) !== null).sort((a, b) => unidad(a) - unidad(b));
    const orden = { NXM: 1, COMBO: 2 };
    const v = rebajas[0] ?? aplica.sort((a, b) => (orden[a.tipo] || 3) - (orden[b.tipo] || 3))[0];
    return { nombre: v.nombre, tipo: v.tipo, valor: v.valor, lleva: v.lleva, paga: v.paga,
             precio_promocional: unidad(v) !== null ? unidad(v) / 100 : null };
};

/** Precios finales de un carrito: promociones vigentes de la sucursal + descuento manual */
const cotizar = async (client, { id_sucursal, lineas, descuento = null }) => {
    const conPromo = aplicarPromociones(lineas, await vigentes(client, id_sucursal));
    const bruto  = conPromo.reduce((s, l) => s + l.brutoCentavos, 0);
    const promo  = conPromo.reduce((s, l) => s + l.descuentoPromoCentavos, 0);
    const manual = descuentoManual(bruto - promo, descuento);
    const partes = repartir(manual.centavos, conPromo.map(l => l.brutoCentavos - l.descuentoPromoCentavos));
    conPromo.forEach((l, i) => {
        l.descuentoManualCentavos = partes[i] || 0;
        l.netoCentavos = l.brutoCentavos - l.descuentoPromoCentavos - l.descuentoManualCentavos;
    });
    return {
        lineas: conPromo, brutoCentavos: bruto, promoCentavos: promo,
        manualCentavos: manual.centavos, motivo: manual.motivo, totalCentavos: bruto - promo - manual.centavos
    };
};

/** La cotización en bolivianos, para la API */
const enBolivianos = (c) => ({
    items: c.lineas.map(l => ({
        id_producto:         l.id_producto,
        cantidad:            l.cantidad,
        precio_unitario:     l.precioCentavos / 100,
        subtotal_bruto:      l.brutoCentavos / 100,
        descuento_promocion: l.descuentoPromoCentavos / 100,
        descuento_manual:    l.descuentoManualCentavos / 100,
        subtotal:            l.netoCentavos / 100,
        id_promocion:        l.id_promocion,
        promociones:         l.promociones
    })),
    subtotal_bruto:        c.brutoCentavos / 100,
    descuento_promociones: c.promoCentavos / 100,
    descuento_manual:      c.manualCentavos / 100,
    total:                 c.totalCentavos / 100
});

// ─── Validación de lo que envía la pantalla ───
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA  = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const normalizar = (b = {}) => {
    const invalida = (m) => errorCodigo('PROMOCION_INVALIDA', m);
    const nombre = String(b.nombre || '').replace(/\s+/g, ' ').trim();
    if (nombre.length < 3 || nombre.length > 80) throw invalida('El nombre debe tener entre 3 y 80 caracteres.');
    if (!TIPOS.includes(b.tipo)) throw invalida('Tipo de promoción inválido.');
    const tipo = b.tipo;

    let valor = Number(b.valor), lleva = null, paga = null;
    if (tipo === 'PORCENTAJE' && !(valor >= 1 && valor <= 99)) throw invalida('El porcentaje debe estar entre 1 y 99.');
    if ((tipo === 'PRECIO' || tipo === 'COMBO') && !(valor > 0 && valor <= 100000)) throw invalida('Indica un precio válido.');
    if (tipo === 'NXM') {
        lleva = Number(b.lleva); paga = Number(b.paga); valor = 0;
        if (!Number.isInteger(lleva) || !Number.isInteger(paga) || lleva < 2 || lleva > 20 || paga < 1 || paga >= lleva)
            throw invalida('En «lleva N y paga M», M debe ser menor que N (por ejemplo 3×2).');
    }
    valor = Math.round(valor * 100) / 100;

    const productos = (Array.isArray(b.productos) ? b.productos : []).map(p => ({
        id_producto: Number(p.id_producto),
        cantidad:    tipo === 'COMBO' ? Number(p.cantidad) : 1
    }));
    if (productos.some(p => !Number.isInteger(p.id_producto) || !Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 50))
        throw invalida('Producto o cantidad inválidos.');
    if (new Set(productos.map(p => p.id_producto)).size !== productos.length) throw invalida('Un producto está repetido.');
    const categorias = [...new Set((Array.isArray(b.categorias) ? b.categorias : []).map(Number))];
    if (categorias.some(c => !Number.isInteger(c))) throw invalida('Categoría inválida.');

    if (tipo === 'COMBO') {
        if (categorias.length) throw invalida('Un combo se arma con productos, no con categorías.');
        if (productos.reduce((s, p) => s + p.cantidad, 0) < 2) throw invalida('Un combo necesita al menos 2 unidades.');
    } else {
        if (tipo === 'PRECIO' && categorias.length) throw invalida('El precio especial se aplica a productos, no a categorías.');
        if (!productos.length && !categorias.length) throw invalida('Elige al menos un producto o una categoría.');
    }

    if (!FECHA.test(b.fecha_inicio || '') || !FECHA.test(b.fecha_fin || '') || isNaN(Date.parse(b.fecha_inicio)) || isNaN(Date.parse(b.fecha_fin)))
        throw invalida('Indica las fechas de inicio y fin.');
    if (b.fecha_inicio > b.fecha_fin) throw invalida('La fecha de inicio no puede ser posterior a la de fin.');

    let dias = Array.isArray(b.dias_semana) ? [...new Set(b.dias_semana.map(Number))].sort((a, x) => a - x) : null;
    if (dias && (dias.some(d => !Number.isInteger(d) || d < 1 || d > 7) || !dias.length)) throw invalida('Días de la semana inválidos.');
    if (dias?.length === 7) dias = null;

    const hora_inicio = b.hora_inicio || null, hora_fin = b.hora_fin || null;
    if (!hora_inicio !== !hora_fin) throw invalida('Indica la hora de inicio y la de fin, o ninguna.');
    if (hora_inicio && (!HORA.test(hora_inicio) || !HORA.test(hora_fin) || hora_inicio.slice(0, 5) === hora_fin.slice(0, 5)))
        throw invalida('Horario inválido.');

    const id_sucursal = b.id_sucursal ? Number(b.id_sucursal) : null;
    return { nombre, tipo, valor, lleva, paga, productos, categorias, fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin,
             dias_semana: dias, hora_inicio, hora_fin, id_sucursal, estado_activo: b.estado_activo !== false };
};

// ─── Consultas ───
const SELECT_PROMOCION = `
    SELECT p.id_promocion, p.nombre, p.tipo, p.valor::float8 AS valor, p.lleva, p.paga, p.id_sucursal, s.nombre_sucursal,
           to_char(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(p.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
           p.dias_semana, to_char(p.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(p.hora_fin, 'HH24:MI') AS hora_fin,
           p.estado_activo, p.fecha_registro, (${CONDICION_VIGENTE}) AS vigente,
           COALESCE((SELECT json_agg(json_build_object('id_producto', pp.id_producto, 'cantidad', pp.cantidad,
                                                       'nombre_producto', pr.nombre_producto, 'precio_unitario', pr.precio_unitario::float8)
                                     ORDER BY pr.nombre_producto)
                     FROM promocion_producto pp JOIN producto pr ON pr.id_producto = pp.id_producto
                     WHERE pp.id_promocion = p.id_promocion), '[]') AS productos,
           COALESCE((SELECT json_agg(json_build_object('id_categoria', c.id_categoria, 'nombre_categoria', c.nombre_categoria)
                                     ORDER BY c.nombre_categoria)
                     FROM promocion_categoria pc JOIN categoria_producto c ON c.id_categoria = pc.id_categoria
                     WHERE pc.id_promocion = p.id_promocion), '[]') AS categorias,
           u.usos, u.ahorro
    FROM promocion p
    LEFT JOIN sucursal s ON s.id_sucursal = p.id_sucursal
    CROSS JOIN LATERAL (
        SELECT COUNT(DISTINCT dv.id_venta)::int AS usos, COALESCE(SUM(dv.descuento_promocion), 0)::float8 AS ahorro
        FROM detalle_venta dv WHERE dv.id_promocion = p.id_promocion
    ) u`;

/** id_sucursal: null = todas; conGlobales: suma las que valen en todas las sucursales */
const listar = async ({ id_sucursal = null, conGlobales = true } = {}) => {
    const r = await db.query(`${SELECT_PROMOCION}
        WHERE ($1::int IS NULL OR p.id_sucursal = $1 OR ($2 AND p.id_sucursal IS NULL))
        ORDER BY p.estado_activo DESC, p.fecha_fin DESC, p.nombre`, [id_sucursal, conGlobales]);
    return r.rows;
};

const obtener = async (id) => (await db.query(`${SELECT_PROMOCION} WHERE p.id_promocion = $1`, [id])).rows[0] || null;

/** Crea (id = null) o reemplaza una promoción con sus productos y categorías */
const guardar = async (datos, id = null, id_usuario = null) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const invalida = (m) => errorCodigo('PROMOCION_INVALIDA', m);

        if (datos.productos.length) {
            const r = await client.query(
                `SELECT id_producto, nombre_producto, precio_unitario::float8 AS precio FROM producto
                 WHERE id_producto = ANY($1::int[]) AND estado_activo = TRUE`, [datos.productos.map(p => p.id_producto)]);
            if (r.rows.length !== datos.productos.length) throw invalida('Un producto no existe o está inactivo.');
            const precio = new Map(r.rows.map(p => [p.id_producto, p]));
            if (datos.tipo === 'PRECIO') {
                const caro = r.rows.find(p => datos.valor >= p.precio);
                if (caro) throw invalida(`El precio especial debe ser menor al precio normal de «${caro.nombre_producto}».`);
            }
            if (datos.tipo === 'COMBO') {
                const normal = datos.productos.reduce((s, p) => s + p.cantidad * precio.get(p.id_producto).precio, 0);
                if (datos.valor >= normal) throw invalida(`El precio del combo debe ser menor a la suma normal (${normal.toFixed(2)}).`);
            }
        }
        if (datos.categorias.length) {
            const r = await client.query(`SELECT COUNT(*)::int AS n FROM categoria_producto WHERE id_categoria = ANY($1::int[])`, [datos.categorias]);
            if (r.rows[0].n !== datos.categorias.length) throw invalida('Una categoría no existe.');
        }
        if (datos.id_sucursal) {
            const r = await client.query(`SELECT 1 FROM sucursal WHERE id_sucursal = $1`, [datos.id_sucursal]);
            if (!r.rows.length) throw invalida('La sucursal no existe.');
        }

        const valores = [datos.nombre, datos.tipo, datos.valor, datos.lleva, datos.paga, datos.id_sucursal, datos.fecha_inicio,
                         datos.fecha_fin, datos.dias_semana, datos.hora_inicio, datos.hora_fin, datos.estado_activo];
        if (id) {
            const r = await client.query(`
                UPDATE promocion SET nombre=$1, tipo=$2, valor=$3, lleva=$4, paga=$5, id_sucursal=$6, fecha_inicio=$7,
                       fecha_fin=$8, dias_semana=$9, hora_inicio=$10, hora_fin=$11, estado_activo=$12
                WHERE id_promocion = $13 RETURNING id_promocion`, [...valores, id]);
            if (!r.rows.length) throw errorCodigo('NO_ENCONTRADA', 'La promoción no existe.');
            await client.query(`DELETE FROM promocion_producto  WHERE id_promocion = $1`, [id]);
            await client.query(`DELETE FROM promocion_categoria WHERE id_promocion = $1`, [id]);
        } else {
            id = (await client.query(`
                INSERT INTO promocion (nombre, tipo, valor, lleva, paga, id_sucursal, fecha_inicio, fecha_fin,
                                       dias_semana, hora_inicio, hora_fin, estado_activo, id_usuario_creador)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id_promocion`, [...valores, id_usuario])).rows[0].id_promocion;
        }
        for (const p of datos.productos)
            await client.query(`INSERT INTO promocion_producto (id_promocion, id_producto, cantidad) VALUES ($1, $2, $3)`,
                               [id, p.id_producto, p.cantidad]);
        for (const c of datos.categorias)
            await client.query(`INSERT INTO promocion_categoria (id_promocion, id_categoria) VALUES ($1, $2)`, [id, c]);

        await client.query('COMMIT');
        return id;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const cambiarEstado = async (id, activo) =>
    (await db.query(`UPDATE promocion SET estado_activo = $2 WHERE id_promocion = $1 RETURNING id_promocion`, [id, activo])).rows.length > 0;

/** Solo si nunca se usó en una venta (si no, se desactiva para conservar el historial) */
const eliminar = async (id) => {
    const usada = await db.query(`SELECT 1 FROM detalle_venta WHERE id_promocion = $1 LIMIT 1`, [id]);
    if (usada.rows.length) throw errorCodigo('EN_USO', 'La promoción ya se usó en ventas: desactívala en lugar de eliminarla.');
    return (await db.query(`DELETE FROM promocion WHERE id_promocion = $1 RETURNING id_promocion`, [id])).rows.length > 0;
};

module.exports = {
    TIPOS, CONDICION_VIGENTE, repartir, aplicarPromociones, descuentoManual, normalizar,
    vigentes, vigentesDetalle, textoPromocion, promocionDeProducto, cotizar, enBolivianos, listar, obtener, guardar, cambiarEstado, eliminar
};
