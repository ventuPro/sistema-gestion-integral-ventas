const propietarioModel = require('../models/propietarioModel');

class ErrorValidacion extends Error {}

// ─── Validación ───
// CI boliviano: números, complemento opcional (-1A) y extensión opcional (LP, CB…)
const CI     = /^\d{4,10}(-[0-9A-Z]{1,2})?( ?(LP|CB|SC|OR|PT|CH|TJ|BE|PD))?$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO = /^[0-9+()\s-]{6,20}$/;

const texto = (valor, max, nombre) => {
    const t = valor == null ? '' : String(valor).trim();
    if (t.length > max) throw new ErrorValidacion(`El campo ${nombre} admite hasta ${max} caracteres`);
    return t || null;
};

const validar = (body) => {
    const p = {
        nombre_completo: texto(body.nombre_completo, 100, 'nombre'),
        ci:              texto(body.ci, 20, 'CI')?.toUpperCase() ?? null,
        cargo:           texto(body.cargo, 60, 'cargo'),
        telefono:        texto(body.telefono, 20, 'teléfono'),
        correo:          texto(body.correo, 100, 'correo')
    };
    if (!p.nombre_completo) throw new ErrorValidacion('El nombre es obligatorio');
    if (p.ci && !CI.test(p.ci)) throw new ErrorValidacion('CI inválido. Ejemplo: 1234567 LP o 1234567-1A LP');
    if (p.telefono && !TELEFONO.test(p.telefono)) throw new ErrorValidacion('Teléfono inválido');
    if (p.correo && !CORREO.test(p.correo)) throw new ErrorValidacion('Correo inválido');

    const porcentaje = Number(body.porcentaje_participacion ?? 0);
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100)
        throw new ErrorValidacion('La participación debe estar entre 0 y 100 %');
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
