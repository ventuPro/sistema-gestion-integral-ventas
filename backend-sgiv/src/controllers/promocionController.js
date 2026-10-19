const promocionModel = require('../models/promocionModel');
const { emitirCatalogo } = require('../utils/tiempoReal');

// ─── Promociones ───
// El administrador gestiona todas; el cajero con permiso, solo las de su sucursal
// (las que valen en todas las sucursales las ve, pero no las cambia).
const esAdmin = (req) => Number(req.usuario.id_rol) === 1;

const puedeEditar = (req, promo) => esAdmin(req) || (promo.id_sucursal !== null && promo.id_sucursal === Number(req.usuario.id_sucursal));

const conPermiso = (req, promo) => ({ ...promo, editable: puedeEditar(req, promo) });

const responderError = (res, e, contexto) => {
    if (e.code === 'PROMOCION_INVALIDA' || e.code === 'EN_USO') return res.status(400).json({ error: e.message });
    if (e.code === 'NO_ENCONTRADA') return res.status(404).json({ error: e.message });
    console.error(`${contexto}:`, e.message);
    res.status(500).json({ error: 'No se pudo completar la operación.' });
};

/** La promoción existente si el usuario puede cambiarla; si no, responde y devuelve null */
const cargarEditable = async (req, res) => {
    const promo = await promocionModel.obtener(Number(req.params.id));
    if (!promo) { res.status(404).json({ error: 'La promoción no existe.' }); return null; }
    if (!puedeEditar(req, promo)) { res.status(403).json({ error: 'Solo puedes cambiar las promociones de tu sucursal.' }); return null; }
    return promo;
};

// GET /api/promociones?id_sucursal=  (admin: 0 o vacío = todas)
const listar = async (req, res) => {
    try {
        const filtro = esAdmin(req)
            ? { id_sucursal: Number(req.query.id_sucursal) || null, conGlobales: true }
            : { id_sucursal: Number(req.usuario.id_sucursal), conGlobales: true };
        const lista = await promocionModel.listar(filtro);
        res.json(lista.map(p => conPermiso(req, p)));
    } catch (e) { responderError(res, e, 'listarPromociones'); }
};

// POST /api/promociones
const crear = async (req, res) => {
    try {
        const datos = promocionModel.normalizar(req.body);
        if (!esAdmin(req)) datos.id_sucursal = Number(req.usuario.id_sucursal);
        const id = await promocionModel.guardar(datos, null, req.usuario.id_usuario);
        emitirCatalogo();
        res.status(201).json({ mensaje: 'Promoción creada', promocion: conPermiso(req, await promocionModel.obtener(id)) });
    } catch (e) { responderError(res, e, 'crearPromocion'); }
};

// PUT /api/promociones/:id
const actualizar = async (req, res) => {
    try {
        if (!(await cargarEditable(req, res))) return;
        const datos = promocionModel.normalizar(req.body);
        if (!esAdmin(req)) datos.id_sucursal = Number(req.usuario.id_sucursal);
        const id = await promocionModel.guardar(datos, Number(req.params.id));
        emitirCatalogo();
        res.json({ mensaje: 'Promoción actualizada', promocion: conPermiso(req, await promocionModel.obtener(id)) });
    } catch (e) { responderError(res, e, 'actualizarPromocion'); }
};

// PATCH /api/promociones/:id/estado { activa }
const cambiarEstado = async (req, res) => {
    try {
        if (typeof req.body?.activa !== 'boolean') return res.status(400).json({ error: 'Estado inválido.' });
        if (!(await cargarEditable(req, res))) return;
        await promocionModel.cambiarEstado(Number(req.params.id), req.body.activa);
        emitirCatalogo();
        res.json({ mensaje: req.body.activa ? 'Promoción activada' : 'Promoción desactivada' });
    } catch (e) { responderError(res, e, 'estadoPromocion'); }
};

// DELETE /api/promociones/:id (solo si nunca se usó)
const eliminar = async (req, res) => {
    try {
        if (!(await cargarEditable(req, res))) return;
        await promocionModel.eliminar(Number(req.params.id));
        emitirCatalogo();
        res.json({ mensaje: 'Promoción eliminada' });
    } catch (e) { responderError(res, e, 'eliminarPromocion'); }
};

module.exports = { listar, crear, actualizar, cambiarEstado, eliminar };
