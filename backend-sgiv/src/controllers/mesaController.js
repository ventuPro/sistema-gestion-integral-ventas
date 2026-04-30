const mesaModel = require('../models/mesaModel');

const listarMesas = async (req, res) => {
    try {
        const id_sucursal = req.params.id_sucursal || req.query.id_sucursal || 1;
        const mesas = await mesaModel.obtenerMesasPorSucursal(id_sucursal);
        res.json(mesas);
    } catch (error) {
        console.error('Error listarMesas:', error);
        res.status(500).json({ error: 'Error al obtener mesas' });
    }
};

const crearMesa = async (req, res) => {
    try {
        const { id_sucursal = 1, numero_mesa } = req.body;
        if (!numero_mesa) return res.status(400).json({ error: 'número de mesa requerido' });
        const mesa = await mesaModel.crearMesa(id_sucursal, numero_mesa);
        res.status(201).json({ mensaje: 'Mesa creada', mesa });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear mesa' });
    }
};

const obtenerQR = async (req, res) => {
    try {
        const { id_mesa } = req.params;
        const base_url    = req.query.base_url || process.env.FRONTEND_URL || 'http://localhost:4200';
        const { url, qrDataUrl } = await mesaModel.generarQRDataUrl(id_mesa, base_url);
        res.json({ id_mesa, url, qr: qrDataUrl });
    } catch (error) {
        res.status(500).json({ error: 'Error al generar QR' });
    }
};

const actualizarMesa = async (req, res) => {
    try {
        const { id_mesa }    = req.params;
        const { estado_mesa } = req.body;
        const mesa = await mesaModel.actualizarEstadoMesa(id_mesa, estado_mesa);
        if (global.io) global.io.to('cajeros').emit('mesa_actualizada', mesa);
        res.json({ mensaje: 'Mesa actualizada', mesa });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar mesa' });
    }
};

module.exports = { listarMesas, crearMesa, obtenerQR, actualizarMesa };