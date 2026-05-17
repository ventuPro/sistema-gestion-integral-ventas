const m = require('../models/mesaModel');

const agregarMesa = async (req, res) => {
    try {
        const { id_sucursal, numero_mesa } = req.body;
        if (!id_sucursal || !numero_mesa)
            return res.status(400).json({ error: 'id_sucursal y numero_mesa son requeridos' });
        const mesa = await m.crearMesa(id_sucursal, numero_mesa);
        res.status(201).json({ mesa });
    } catch(e) {
        console.error('agregarMesa:', e);
        res.status(500).json({ error: e.message });
    }
};

const listarMesas = async (req, res) => {
    try {
        res.json(await m.obtenerMesasPorSucursal(req.params.id_sucursal));
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
};

const obtenerQR = async (req, res) => {
    try {
        const id_mesa  = req.params.id_mesa;
        const base_url = req.query.base_url
            ? decodeURIComponent(req.query.base_url)
            : 'http://localhost:4200';

        console.log(`🔗 Generando QR para Mesa ${id_mesa} → ${base_url}/menu/${id_mesa}`);
        const result = await m.generarQR(id_mesa, base_url);
        res.json(result);
    } catch(e) {
        console.error('obtenerQR:', e);
        res.status(500).json({ error: e.message });
    }
};

const actualizarEstado = async (req, res) => {
    try {
        const mesa = await m.actualizarEstadoMesa(req.params.id_mesa, req.body.estado_mesa);
        res.json({ mesa });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = { agregarMesa, listarMesas, obtenerQR, actualizarEstado };