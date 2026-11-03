const costoModel = require('../models/costoModel');
const { mayusculas } = require('../utils/texto');

// ─── Costos de producción (solo administrador) ───

class ErrorValidacion extends Error {}

const nombre = (valor) => {
    const t = mayusculas(String(valor ?? '').replace(/\s+/g, ' ').trim());
    if (!t) throw new ErrorValidacion('El nombre es obligatorio');
    if (t.length > 80) throw new ErrorValidacion('El nombre admite hasta 80 caracteres');
    return t;
};

/** Número positivo con hasta `decimales` decimales */
const positivo = (valor, campo, { decimales = 4, max = 1e9, cero = false } = {}) => {
    const v = Number(valor);
    if (!Number.isFinite(v) || v < 0 || (!cero && v === 0) || v > max) throw new ErrorValidacion(`${campo} inválido`);
    const f = 10 ** decimales;
    return Math.round(v * f) / f;
};

const entero = (valor, campo) => {
    const v = Number(valor);
    if (!Number.isInteger(v) || v <= 0) throw new ErrorValidacion(`${campo} inválido`);
    return v;
};

const datosInsumo = (b, parcial = false) => {
    const d = {};
    if (!parcial || b.nombre !== undefined)           d.nombre = nombre(b.nombre);
    if (!parcial || b.cantidad_compra !== undefined)  d.cantidad_compra = positivo(b.cantidad_compra, 'Cantidad de compra');
    if (!parcial || b.id_unidad_compra !== undefined) d.id_unidad_compra = entero(b.id_unidad_compra, 'Unidad');
    if (!parcial || b.precio_compra !== undefined)    d.precio_compra = positivo(b.precio_compra, 'Precio', { decimales: 2, max: 1e7, cero: true });
    return d;
};

const datosReceta = (b) => {
    const ingredientes = Array.isArray(b.ingredientes) ? b.ingredientes : [];
    if (!ingredientes.length) throw new ErrorValidacion('Agrega al menos un insumo');
    if (ingredientes.length > 100) throw new ErrorValidacion('Máximo 100 insumos por receta');
    const lista = ingredientes.map(x => ({
        id_insumo: entero(x.id_insumo, 'Insumo'),
        cantidad:  positivo(x.cantidad, 'Cantidad'),
        id_unidad: entero(x.id_unidad, 'Unidad')
    }));
    if (new Set(lista.map(x => x.id_insumo)).size !== lista.length)
        throw new ErrorValidacion('Un insumo está repetido: suma sus cantidades en una sola fila');
    return { nombre: nombre(b.nombre), rendimiento: positivo(b.rendimiento, 'Rendimiento', { decimales: 2, max: 1e6 }),
             id_producto: b.id_producto ? entero(b.id_producto, 'Producto') : null, ingredientes: lista };
};

const ESTADOS = { INVALIDO: 400, NO_EXISTE: 404, DUPLICADO: 409, EN_USO: 409 };

const responder = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        if (e instanceof ErrorValidacion) return res.status(400).json({ error: e.message });
        if (ESTADOS[e.codigo]) return res.status(ESTADOS[e.codigo]).json({ error: e.message });
        console.error('costos:', e);
        res.status(500).json({ error: 'No se pudo completar la operación' });
    }
};

const id = (req) => entero(req.params.id, 'Identificador');

module.exports = {
    unidades:         responder(async (req, res) => res.json(await costoModel.unidades())),
    productos:        responder(async (req, res) => res.json(await costoModel.productos())),
    listarInsumos:    responder(async (req, res) => res.json(await costoModel.listarInsumos())),
    crearInsumo:      responder(async (req, res) =>
        res.status(201).json(await costoModel.crearInsumo(datosInsumo(req.body || {}), req.usuario.id_usuario))),
    actualizarInsumo: responder(async (req, res) =>
        res.json(await costoModel.actualizarInsumo(id(req), datosInsumo(req.body || {}, true), req.usuario.id_usuario))),
    eliminarInsumo:   responder(async (req, res) => { await costoModel.eliminarInsumo(id(req)); res.json({ mensaje: 'Insumo eliminado' }); }),
    historialInsumo:  responder(async (req, res) => res.json(await costoModel.historialInsumo(id(req)))),

    listarRecetas:    responder(async (req, res) => res.json(await costoModel.listarRecetas())),
    obtenerReceta:    responder(async (req, res) => {
        const r = await costoModel.obtenerReceta(id(req));
        if (!r) return res.status(404).json({ error: 'Receta no encontrada' });
        res.json(r);
    }),
    crearReceta:      responder(async (req, res) =>
        res.status(201).json(await costoModel.guardarReceta(null, datosReceta(req.body || {}), req.usuario.id_usuario))),
    actualizarReceta: responder(async (req, res) =>
        res.json(await costoModel.guardarReceta(id(req), datosReceta(req.body || {}), req.usuario.id_usuario))),
    eliminarReceta:   responder(async (req, res) => { await costoModel.eliminarReceta(id(req)); res.json({ mensaje: 'Receta eliminada' }); }),
    historialReceta:  responder(async (req, res) => res.json(await costoModel.historialReceta(id(req))))
};
