const cajaModel = require('../models/cajaModel');

// ─── CONTROL DE CAJA (Admin) ───
const getEstadoCaja = async (req, res) => {
    try {
        const estado = await cajaModel.obtenerEstadoCaja(req.params.id_usuario);
        res.json({ caja_habilitada: estado?.caja_habilitada ?? false });
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener estado de caja' });
    }
};

const habilitarCajaUsuario = async (req, res) => {
    try {
        // FIX: convertir a número para evitar comparación string vs number
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede habilitar la caja' });

        const id_usuario = Number(req.params.id_usuario);
        const resultado  = await cajaModel.habilitarCaja(id_usuario);

        if (!resultado)
            return res.status(404).json({ error: 'Usuario no encontrado' });

        res.json({ mensaje: 'Caja habilitada correctamente', usuario: resultado });
    } catch (e) {
        console.error('Error habilitarCajaUsuario:', e);
        res.status(500).json({ error: 'Error al habilitar caja' });
    }
};

const deshabilitarCajaUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede cerrar la caja' });

        const id_usuario = Number(req.params.id_usuario);
        const resultado  = await cajaModel.deshabilitarCaja(id_usuario);

        if (!resultado)
            return res.status(404).json({ error: 'Usuario no encontrado' });

        res.json({ mensaje: 'Caja cerrada correctamente', usuario: resultado });
    } catch (e) {
        console.error('Error deshabilitarCajaUsuario:', e);
        res.status(500).json({ error: 'Error al deshabilitar caja' });
    }
};

// ─── ARQUEO DEL DÍA ───
const getArqueoHoy = async (req, res) => {
    try {
        const id_sucursal       = req.params.id_sucursal;
        const id_usuario_cajero = req.usuario.id_usuario;
        const data = await cajaModel.obtenerArqueoHoy(id_sucursal, id_usuario_cajero);
        res.json(data);
    } catch (e) {
        console.error('Error en getArqueoHoy:', e);
        res.status(500).json({ error: 'Error al obtener el arqueo' });
    }
};

// ─── VENTAS HOY (para POS) ───
const getVentasHoyPOS = async (req, res) => {
    try {
        const id_sucursal       = req.params.id_sucursal;
        const id_usuario_cajero = req.usuario.id_usuario;
        const ventas = await cajaModel.obtenerVentasHoyPOS(id_sucursal, id_usuario_cajero);
        res.json(ventas);
    } catch (e) {
        console.error('Error en getVentasHoyPOS:', e);
        res.status(500).json({ error: 'Error al obtener ventas del día' });
    }
};

// ─── CIERRE DE CAJA ───
const cerrarCaja = async (req, res) => {
    try {
        const id_usuario_cajero = req.usuario.id_usuario;
        const { id_sucursal }   = req.body;
        const resultado = await cajaModel.cerrarCaja(id_sucursal, id_usuario_cajero);
        res.json(resultado);
    } catch (e) {
        console.error('Error en cerrarCaja:', e);
        res.status(500).json({ error: 'Error al cerrar la caja' });
    }
};

// ─── TURNO ───
const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal, monto_inicial } = req.body;
        const id_usuario_cajero = req.usuario.id_usuario;
        const turno = await cajaModel.abrirTurno(id_sucursal, id_usuario_cajero, monto_inicial);
        res.status(201).json({ mensaje: 'Turno abierto', turno });
    } catch (e) {
        if (e.message === 'CAJA_NO_HABILITADA')
            return res.status(403).json({ error: 'Tu caja no está habilitada. Contacta al Administrador.' });
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'Ya tienes un turno abierto.' });
        res.status(500).json({ error: 'Error al abrir la caja' });
    }
};

// ─── VENTA ───
const cobrarVenta = async (req, res) => {
    try {
        const datosVenta = req.body;
        datosVenta.id_usuario_cajero = req.usuario.id_usuario;
        const id_venta = await cajaModel.registrarVenta(datosVenta);
        res.status(201).json({ mensaje: 'Venta registrada con éxito', id_venta });
    } catch (e) {
        console.error('Error en cobrarVenta:', e);
        res.status(500).json({ error: 'Error al registrar la venta.' });
    }
};

const getCierresCaja = async (req, res) => {
    try {
        if (req.usuario.id_rol !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede ver los cierres' });
        const cierres = await cajaModel.obtenerCierresCaja();
        res.json(cierres);
    } catch (e) {
        console.error('Error en getCierresCaja:', e);
        res.status(500).json({ error: 'Error al obtener cierres de caja' });
    }
};

const getTurnoHoy = async (req, res) => {
    try {
        const id_usuario_cajero = req.usuario.id_usuario;
        const turno = await cajaModel.verificarTurnoHoy(id_usuario_cajero);
        res.json({ turno });
    } catch (e) {
        console.error('Error en getTurnoHoy:', e);
        res.status(500).json({ error: 'Error al verificar turno' });
    }
};

module.exports = {
    getEstadoCaja, habilitarCajaUsuario, deshabilitarCajaUsuario,
    getArqueoHoy, getVentasHoyPOS,
    cerrarCaja, abrirCaja, cobrarVenta,
    getCierresCaja,
    getTurnoHoy
};