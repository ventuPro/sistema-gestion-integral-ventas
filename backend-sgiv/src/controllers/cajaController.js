const cajaModel = require('../models/cajaModel');

const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal, id_usuario_cajero, monto_inicial } = req.body;
        const turno = await cajaModel.abrirTurno(id_sucursal, id_usuario_cajero, monto_inicial);
        res.status(201).json({ mensaje: 'Turno de caja abierto', turno });
    } catch (error) {
        console.error('Error en abrirCaja:', error);
        res.status(500).json({ error: 'Error al abrir la caja' });
    }
};

const cobrarVenta = async (req, res) => {
    try {
        // Recibimos todos los datos y un arreglo de "detalles" con los productos vendidos
        const id_venta = await cajaModel.registrarVenta(req.body);
        res.status(201).json({ mensaje: 'Venta registrada con éxito y stock descontado', id_venta });
    } catch (error) {
        console.error('Error en cobrarVenta:', error);
        res.status(500).json({ error: 'Error al registrar la venta. Verifique el stock o los datos.' });
    }
};

module.exports = { abrirCaja, cobrarVenta };