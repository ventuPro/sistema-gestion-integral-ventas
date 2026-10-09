const sucursalModel = require('../models/sucursalModel');

class ErrorValidacion extends Error {}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// ─── Validación ───
const texto = (valor, max, nombre) => {
    const t = valor == null ? '' : String(valor).trim();
    if (t.length > max) throw new ErrorValidacion(`El campo ${nombre} admite hasta ${max} caracteres`);
    return t || null;
};

const validarDatos = (body) => {
    const nombre = texto(body.nombre_sucursal, 100, 'nombre');
    if (!nombre) throw new ErrorValidacion('El nombre es obligatorio');
    const direccion = texto(body.direccion_fisica, 250, 'dirección');
    const telefono  = texto(body.telefono_contacto, 15, 'teléfono');
    if (telefono && !/^[0-9+()\s-]{6,15}$/.test(telefono)) throw new ErrorValidacion('Teléfono inválido');
    return { nombre, direccion, telefono, horario: validarHorario(body.horario) };
};

const validarHorario = (horario) => {
    if (horario == null) return [];
    if (!Array.isArray(horario) || horario.length > 7) throw new ErrorValidacion('Horario inválido');
    const dias = new Set();
    return horario.map(h => {
        const dia = Number(h?.dia_semana);
        if (!Number.isInteger(dia) || dia < 1 || dia > 7 || dias.has(dia)) throw new ErrorValidacion('Horario inválido');
        dias.add(dia);
        if (!h.abierto) return { dia_semana: dia, abierto: false, hora_apertura: null, hora_cierre: null };
        if (!HORA.test(h.hora_apertura) || !HORA.test(h.hora_cierre))
            throw new ErrorValidacion('Indique la hora de apertura y cierre (HH:MM) de cada día abierto');
        if (h.hora_apertura === h.hora_cierre)
            throw new ErrorValidacion('La hora de apertura y la de cierre no pueden ser iguales');
        return { dia_semana: dia, abierto: true, hora_apertura: h.hora_apertura, hora_cierre: h.hora_cierre };
    });
};

const idValido = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const responderError = (res, e, accion) => {
    if (e instanceof ErrorValidacion) return res.status(400).json({ error: e.message });
    console.error(`Error al ${accion} la sucursal:`, e);
    res.status(500).json({ error: `Error al ${accion} la sucursal` });
};

// ─── Endpoints ───
const listarSucursales = async (req, res) => {
    try {
        const sucursales = await sucursalModel.obtenerSucursales();
        res.json(sucursales);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener sucursales' });
    }
};

const crearSucursal = async (req, res) => {
    try {
        const d = validarDatos(req.body || {});
        if (await sucursalModel.existeNombre(d.nombre))
            return res.status(409).json({ error: 'Ya existe una sucursal con ese nombre' });
        const nueva = await sucursalModel.crearSucursal(d.nombre, d.direccion, d.telefono, d.horario);
        res.status(201).json({ mensaje: 'Sucursal creada', sucursal: nueva });
    } catch (e) {
        responderError(res, e, 'crear');
    }
};

const actualizarSucursal = async (req, res) => {
    try {
        const id = idValido(req);
        if (!id) return res.status(404).json({ error: 'Sucursal no encontrada' });
        const d = validarDatos(req.body || {});
        if (await sucursalModel.existeNombre(d.nombre, id))
            return res.status(409).json({ error: 'Ya existe una sucursal con ese nombre' });
        const s = await sucursalModel.actualizarSucursal(id, d.nombre, d.direccion, d.telefono, d.horario);
        if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
        res.json({ mensaje: 'Sucursal actualizada', sucursal: s });
    } catch (e) {
        responderError(res, e, 'actualizar');
    }
};

const cambiarEstado = async (req, res) => {
    try {
        const id = idValido(req);
        if (!id) return res.status(404).json({ error: 'Sucursal no encontrada' });
        const activo = req.body?.estado_activo === true;
        if (!activo) {
            const motivos = await sucursalModel.motivosParaNoDesactivar(id);
            if (motivos.length)
                return res.status(409).json({ error: `No se puede desactivar: ${motivos.join(', ')}.` });
        }
        const s = await sucursalModel.cambiarEstado(id, activo);
        if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
        res.json({ mensaje: activo ? 'Sucursal activada' : 'Sucursal desactivada', sucursal: s });
    } catch (e) {
        responderError(res, e, 'cambiar el estado de');
    }
};

module.exports = { listarSucursales, crearSucursal, actualizarSucursal, cambiarEstado };
