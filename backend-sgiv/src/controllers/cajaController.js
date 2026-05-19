const cajaModel = require('../models/cajaModel');

// ─── ESTADO COMPLETO (la fuente de verdad para el front) ──────────
const getEstadoCompleto = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario) || req.usuario.id_usuario;
        const data = await cajaModel.obtenerEstadoCompleto(id_usuario);
        res.json(data);
    } catch (e) {
        console.error('getEstadoCompleto:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── ESTADO SIMPLE (legacy) ────────────────────────────────────────
const getEstadoCaja = async (req, res) => {
    try {
        const dato = await cajaModel.obtenerEstadoCaja(Number(req.params.id_usuario));
        res.json({ caja_habilitada: dato?.caja_habilitada ?? false });
    } catch (e) {
        console.error('getEstadoCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── CONTROL ADMIN: habilitar / deshabilitar caja ─────────────────
const habilitarCajaUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede habilitar la caja' });
        const r = await cajaModel.habilitarCaja(Number(req.params.id_usuario));
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        const msg = r.accion === 'TURNO_REABIERTO'
            ? 'Caja reabierta — el cajero ya puede vender nuevamente'
            : 'Caja habilitada';
        res.json({ mensaje: msg, usuario: r });
    } catch (e) {
        console.error('habilitarCaja:', e.message);
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'El cajero ya tiene un turno abierto.' });
        res.status(500).json({ error: e.message });
    }
};

const deshabilitarCajaUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede cerrar la caja' });
        const r = await cajaModel.deshabilitarCaja(Number(req.params.id_usuario));
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ mensaje: 'Caja cerrada', usuario: r });
    } catch (e) {
        console.error('deshabilitarCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── REAPERTURA EXPLÍCITA POR ADMIN ───────────────────────────────
const reabrirCajaAdmin = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede reabrir caja' });
        const id_usuario_cajero = Number(req.params.id_usuario);
        const turno = await cajaModel.reabrirTurno(id_usuario_cajero);
        res.json({ mensaje: 'Caja reabierta correctamente', turno });
    } catch (e) {
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'El cajero ya tiene un turno abierto.' });
        if (e.message === 'NO_HAY_TURNO_CERRADO_HOY')
            return res.status(404).json({ error: 'No hay turno cerrado hoy para reabrir.' });
        console.error('reabrirCajaAdmin:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── TURNO ────────────────────────────────────────────────────────
const getTurnoHoy = async (req, res) => {
    try {
        const turno = await cajaModel.verificarTurnoHoy(req.usuario.id_usuario);
        res.json({ turno });
    } catch (e) {
        console.error('getTurnoHoy:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal, monto_inicial } = req.body;
        const turno = await cajaModel.abrirTurno(
            Number(id_sucursal) || req.usuario.id_sucursal,
            req.usuario.id_usuario,
            Number(monto_inicial) || 0
        );
        res.status(201).json({ mensaje: 'Turno abierto', turno });
    } catch (e) {
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'Ya tienes un turno abierto.' });
        console.error('abrirCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const cerrarCaja = async (req, res) => {
    try {
        const { id_sucursal } = req.body;
        const r = await cajaModel.cerrarCaja(
            Number(id_sucursal) || req.usuario.id_sucursal,
            req.usuario.id_usuario
        );
        res.json(r);
    } catch (e) {
        console.error('cerrarCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── ARQUEO / VENTAS ──────────────────────────────────────────────
const getArqueoHoy = async (req, res) => {
    try {
        const data = await cajaModel.obtenerArqueoHoy(
            Number(req.params.id_sucursal),
            req.usuario.id_usuario
        );
        res.json(data);
    } catch (e) {
        console.error('getArqueoHoy:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const getVentasHoyPOS = async (req, res) => {
    try {
        const ventas = await cajaModel.obtenerVentasHoyPOS(
            Number(req.params.id_sucursal),
            req.usuario.id_usuario
        );
        res.json(ventas);
    } catch (e) {
        console.error('getVentasHoyPOS:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const getCierresCaja = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador' });
        const cierres = await cajaModel.obtenerCierresCaja();
        res.json(cierres);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const cobrarVenta = async (req, res) => {
    try {
        const datos = { ...req.body, id_usuario_cajero: req.usuario.id_usuario };
        const id_venta = await cajaModel.registrarVenta(datos);
        global.io?.emit('stock:actualizado', {
            id_sucursal: datos.id_sucursal,
            productos: datos.detalles.map(d => ({ id_producto: d.id_producto, cantidad_vendida: d.cantidad }))
        });
        res.status(201).json({ mensaje: 'Venta registrada', id_venta });
    } catch (e) {
        console.error('cobrarVenta:', e.message);
        if (e.message === 'CAJA_CERRADA')
            return res.status(403).json({
                error: 'CAJA_CERRADA',
                detalle: 'Tu caja está cerrada. Pide al administrador que la reabra.'
            });
        res.status(500).json({ error: 'Error al registrar la venta.', detalle: e.message });
    }
};

// ─── ESTADO PARA PANEL PRINCIPAL ─────────────────────────────────
const getEstadoCajaSucursal = async (req, res) => {
    try {
        const r = await cajaModel.obtenerEstadoCajaSucursal(Number(req.params.id_sucursal));
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getEstadoCaja, getEstadoCompleto,
    habilitarCajaUsuario, deshabilitarCajaUsuario, reabrirCajaAdmin,
    getTurnoHoy, abrirCaja, cerrarCaja,
    getArqueoHoy, getVentasHoyPOS, getCierresCaja, cobrarVenta,
    getEstadoCajaSucursal
};
