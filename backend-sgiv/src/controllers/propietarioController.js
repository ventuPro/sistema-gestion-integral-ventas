const propietarioModel = require('../models/propietarioModel');
const { ErrorValidacion, revisar, numero } = require('../utils/validacion');

// ─── Validación ───
const validar = (body) => {
    const p = {
        nombre_completo: revisar(body.nombre_completo, 'persona', { etiqueta: 'El nombre', obligatorio: true, max: 100 }),
        ci:              revisar(body.ci, 'ci', { etiqueta: 'El CI', max: 20 }),
        cargo:           revisar(body.cargo, 'letras', { etiqueta: 'El cargo', max: 60 }),
        telefono:        revisar(body.telefono, 'telefono', { etiqueta: 'El teléfono' }),
        correo:          revisar(body.correo, 'correo', { etiqueta: 'El correo', max: 100 })
    };
    const porcentaje = numero(body.porcentaje_participacion ?? 0, { etiqueta: 'La participación', min: 0, max: 100 });
    p.porcentaje_participacion = Math.round(porcentaje * 100) / 100;
    return p;
};

const responderError = (res, e) => {
    if (e instanceof ErrorValidacion) return res.status(400).json({ error: e.message });
    if (e.codigo === 'SUPERA_100')    return res.status(400).json({ error: e.message });
    if (e.code === '23505')           return res.status(409).json({ error: 'Ya existe un propietario con ese CI' });
    console.error('Error en propietarios:', e);
    res.status(500).json({ error: 'No se pudo guardar el propietario' });
};

const idValido = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
};

// ─── Endpoints (solo administrador) ───
const listar = async (req, res) => {
    try {
        res.json(await propietarioModel.listar());
    } catch (e) {
        console.error('Error al listar propietarios:', e);
        res.status(500).json({ error: 'No se pudieron obtener los propietarios' });
    }
};

const crear = async (req, res) => {
    try {
        const p = await propietarioModel.guardar(null, validar(req.body || {}));
        res.status(201).json({ mensaje: 'Propietario registrado', propietario: p });
    } catch (e) {
        responderError(res, e);
    }
};

const actualizar = async (req, res) => {
    try {
        const id = idValido(req);
        if (!id) return res.status(404).json({ error: 'Propietario no encontrado' });
        const p = await propietarioModel.guardar(id, validar(req.body || {}));
        if (!p) return res.status(404).json({ error: 'Propietario no encontrado' });
        res.json({ mensaje: 'Propietario actualizado', propietario: p });
    } catch (e) {
        responderError(res, e);
    }
};

const eliminar = async (req, res) => {
    try {
        const id = idValido(req);
        if (!id || !(await propietarioModel.eliminar(id)))
            return res.status(404).json({ error: 'Propietario no encontrado' });
        res.json({ mensaje: 'Propietario eliminado' });
    } catch (e) {
        responderError(res, e);
    }
};

module.exports = { listar, crear, actualizar, eliminar };
