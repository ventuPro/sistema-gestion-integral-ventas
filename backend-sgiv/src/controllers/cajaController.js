const cajaModel = require('../models/cajaModel');

// ─── ESTADO Y CONTROL DE CAJA (Admin) ───
const getEstadoCaja = async (req, res) => {
    try {
        const { id_usuario } = req.params;
        const estado = await cajaModel.obtenerEstadoCaja(id_usuario);
        res.json({ caja_habilitada: estado?.caja_habilitada ?? false });
    } catch (error) {
        console.error('Error en getEstadoCaja:', error);
        res.status(500).json({ error: 'Error al obtener estado de caja' });
    }
};

const habilitarCajaUsuario = async (req, res) => {
    try {
        // Solo admin puede habilitar
        if (req.usuario.id_rol !== 1) {
            return res.status(403).json({ error: 'Solo el administrador puede habilitar la caja' });
        }
        const { id_usuario } = req.params;
        const resultado = await cajaModel.habilitarCaja(id_usuario);
        res.json({ mensaje: 'Caja habilitada correctamente', usuario: resultado });
    } catch (error) {
        console.error('Error en habilitarCaja:', error);
        res.status(500).json({ error: 'Error al habilitar caja' });
    }
};

const deshabilitarCajaUsuario = async (req, res) => {
    try {
        // Solo admin puede deshabilitar manualmente
        if (req.usuario.id_rol !== 1) {
            return res.status(403).json({ error: 'Solo el administrador puede cerrar la caja' });
        }
        const { id_usuario } = req.params;
        const resultado = await cajaModel.deshabilitarCaja(id_usuario);
        res.json({ mensaje: 'Caja cerrada correctamente', usuario: resultado });
    } catch (error) {
        console.error('Error en deshabilitarCaja:', error);
        res.status(500).json({ error: 'Error al deshabilitar caja' });
    }
};

// ─── TURNO ───
const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal, monto_inicial } = req.body;
        const id_usuario_cajero = req.usuario.id_usuario;

        const turno = await cajaModel.abrirTurno(id_sucursal, id_usuario_cajero, monto_inicial);
        res.status(201).json({ mensaje: 'Turno de caja abierto', turno });
    } catch (error) {
        if (error.message === 'CAJA_NO_HABILITADA') {
            return res.status(403).json({ error: 'Tu caja no está habilitada. Contacta al Administrador.' });
        }
        if (error.message === 'YA_TIENE_TURNO_ABIERTO') {
            return res.status(400).json({ error: 'Ya tienes un turno abierto.' });
        }
        console.error('Error en abrirCaja:', error);
        res.status(500).json({ error: 'Error al abrir la caja' });
    }
};

const cobrarVenta = async (req, res) => {
    try {
        const datosVenta = req.body;
        datosVenta.id_usuario_cajero = req.usuario.id_usuario;

        const id_venta = await cajaModel.registrarVenta(datosVenta);
        res.status(201).json({ mensaje: 'Venta registrada con éxito y stock descontado', id_venta });
    } catch (error) {
        console.error('Error en cobrarVenta:', error);
        res.status(500).json({ error: 'Error al registrar la venta.' });
    }
};

const obtenerArqueo = async (req, res) => {
    try {
        const { id_sucursal } = req.params;
        const { fecha_inicio, fecha_fin } = req.query;

        const inicio = fecha_inicio || new Date().toISOString().split('T')[0] + ' 00:00:00';
        const fin    = fecha_fin    || new Date().toISOString().split('T')[0] + ' 23:59:59';

        const arqueo = await cajaModel.obtenerArqueo(id_sucursal, inicio, fin);
        res.json(arqueo);
    } catch (error) {
        console.error('Error en obtenerArqueo:', error);
        res.status(500).json({ error: 'Error al obtener el arqueo' });
    }
};

const cierreDiario = async (req, res) => {
    try {
        const { id_turno, monto_real_declarado } = req.body;
        const turno = await cajaModel.cerrarTurno(id_turno, monto_real_declarado);
        res.json({ mensaje: 'Caja cerrada. Se requiere autorización del administrador para reabrir.', turno });
    } catch (error) {
        console.error('Error en cierreDiario:', error);
        res.status(500).json({ error: 'Error al cerrar la caja' });
    }
};

module.exports = {
    getEstadoCaja,
    habilitarCajaUsuario,
    deshabilitarCajaUsuario,
    abrirCaja,
    cobrarVenta,
    obtenerArqueo,
    cierreDiario
};