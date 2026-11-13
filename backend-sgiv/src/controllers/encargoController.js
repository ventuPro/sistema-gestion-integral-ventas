const encargoModel = require('../models/encargoModel');
const { emitirCajeros } = require('../utils/tiempoReal');

// ─── Encargos ───
// El administrador ve y gestiona los de todas las sucursales; el cajero, solo los de la suya.
const esAdmin = (req) => Number(req.usuario.id_rol) === 1;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Sucursal a consultar: admin la que pida (0/vacío = todas); cajero siempre la suya */
const sucursalConsulta = (req) => esAdmin(req) ? (Number(req.query.id_sucursal) || null) : Number(req.usuario.id_sucursal);

const avisarCambio = (id_sucursal) => emitirCajeros('encargos:actualizados', { id_sucursal });

const responderError = (res, e, contexto) => {
    if (e.code === 'VALIDACION' || e.codigo === 'INVALIDA') return res.status(400).json({ error: e.message });
    if (e.codigo === 'NO_EXISTE') return res.status(404).json({ error: e.message });
    console.error(`${contexto}:`, e.message);
    res.status(500).json({ error: 'No se pudo completar la operación.' });
};

/** El encargo existe y el usuario puede tocarlo; si no, responde y devuelve null */
const sucursalEditable = async (req, res) => {
    const id_sucursal = await encargoModel.sucursalDe(Number(req.params.id));
    if (id_sucursal === null) { res.status(404).json({ error: 'El encargo no existe.' }); return null; }
    if (!esAdmin(req) && id_sucursal !== Number(req.usuario.id_sucursal)) {
        res.status(403).json({ error: 'Solo puedes gestionar los encargos de tu sucursal.' });
        return null;
    }
    return id_sucursal;
};

// GET /api/encargos?id_sucursal&desde&hasta&estado&buscar
const listar = async (req, res) => {
    try {
        const { desde, hasta, estado, buscar } = req.query;
        if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta)))
            return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
        res.json(await encargoModel.listar({
            id_sucursal: sucursalConsulta(req), desde: desde || null, hasta: hasta || null,
            estado: ['Recibido', 'Entregado'].includes(estado) ? estado : null,
            texto: String(buscar || '').trim().slice(0, 50) || null
        }));
    } catch (e) { responderError(res, e, 'listarEncargos'); }
};

// GET /api/encargos/hoy  pendientes de hoy (y atrasados): ventana al iniciar el día
const pendientesHoy = async (req, res) => {
    try {
        res.json(await encargoModel.pendientesHoy(esAdmin(req) ? null : Number(req.usuario.id_sucursal)));
    } catch (e) { responderError(res, e, 'encargosHoy'); }
};

// GET /api/encargos/:id
const obtener = async (req, res) => {
    try {
        if (!(await sucursalEditable(req, res))) return;
        res.json(await encargoModel.obtener(Number(req.params.id)));
    } catch (e) { responderError(res, e, 'obtenerEncargo'); }
};

// POST /api/encargos
const crear = async (req, res) => {
    try {
        const datos = encargoModel.normalizar(req.body);
        if (!esAdmin(req)) datos.id_sucursal = Number(req.usuario.id_sucursal);
        const encargo = await encargoModel.guardar(datos, null, req.usuario.id_usuario);
        avisarCambio(encargo.id_sucursal);
        res.status(201).json({ mensaje: `Encargo #${encargo.id_encargo} registrado`, encargo });
    } catch (e) { responderError(res, e, 'crearEncargo'); }
};

// PUT /api/encargos/:id
const actualizar = async (req, res) => {
    try {
        const previa = await sucursalEditable(req, res);
        if (!previa) return;
        const datos = encargoModel.normalizar(req.body);
        if (!esAdmin(req)) datos.id_sucursal = Number(req.usuario.id_sucursal);
        const encargo = await encargoModel.guardar(datos, Number(req.params.id), req.usuario.id_usuario);
        avisarCambio(encargo.id_sucursal);
        if (previa !== encargo.id_sucursal) avisarCambio(previa);
        res.json({ mensaje: 'Encargo actualizado', encargo });
    } catch (e) { responderError(res, e, 'actualizarEncargo'); }
};

// PATCH /api/encargos/:id/estado { entregado }
const cambiarEstado = async (req, res) => {
    try {
        if (typeof req.body?.entregado !== 'boolean') return res.status(400).json({ error: 'Estado inválido.' });
        if (!(await sucursalEditable(req, res))) return;
        const encargo = await encargoModel.cambiarEstado(Number(req.params.id), req.body.entregado, req.usuario.id_usuario);
        avisarCambio(encargo.id_sucursal);
        res.json({ mensaje: req.body.entregado ? 'Encargo entregado' : 'Entrega deshecha', encargo });
    } catch (e) { responderError(res, e, 'estadoEncargo'); }
};

// DELETE /api/encargos/:id  (solo los que no se entregaron)
const eliminar = async (req, res) => {
    try {
        const id_sucursal = await sucursalEditable(req, res);
        if (!id_sucursal) return;
        await encargoModel.eliminar(Number(req.params.id));
        avisarCambio(id_sucursal);
        res.json({ mensaje: 'Encargo eliminado' });
    } catch (e) { responderError(res, e, 'eliminarEncargo'); }
};

module.exports = { listar, pendientesHoy, obtener, crear, actualizar, cambiarEstado, eliminar };
