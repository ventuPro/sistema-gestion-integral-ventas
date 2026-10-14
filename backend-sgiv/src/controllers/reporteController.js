const reporteModel = require('../models/reporteModel');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;

// El cajero solo ve su sucursal; el administrador puede pedir 0 = todas
const sucursalPermitida = (req) => {
    if (Number(req.usuario.id_rol) !== 1) return Number(req.usuario.id_sucursal);
    const id = Number(req.params.id_sucursal);
    return Number.isInteger(id) && id >= 0 ? id : null;
};

const fechaValida = (f) => FECHA.test(f || '') && !Number.isNaN(Date.parse(f + 'T00:00:00Z'));

// ─── Panel del día ───
const obtenerPanel = async (req, res) => {
    try {
        const id_sucursal = sucursalPermitida(req);
        if (id_sucursal === null) return res.status(400).json({ error: 'Sucursal inválida' });
        const cat = Number(req.query.categoria);
        const id_categoria = Number.isInteger(cat) && cat > 0 ? cat : null;
        res.json(await reporteModel.obtenerPanel(id_sucursal, id_categoria));
    } catch (error) {
        console.error('Error en obtenerPanel:', error);
        res.status(500).json({ error: 'Error al generar el panel' });
    }
};

// ─── Informe por período ───
const obtenerInforme = async (req, res) => {
    try {
        const id_sucursal = sucursalPermitida(req);
        if (id_sucursal === null) return res.status(400).json({ error: 'Sucursal inválida' });

        const { fecha_inicio, fecha_fin, categorias } = req.query;
        if (!fechaValida(fecha_inicio) || !fechaValida(fecha_fin))
            return res.status(400).json({ error: 'Fechas requeridas en formato YYYY-MM-DD' });
        if (fecha_inicio > fecha_fin)
            return res.status(400).json({ error: 'La fecha de inicio no puede ser mayor a la final' });
        const dias = (Date.parse(fecha_fin) - Date.parse(fecha_inicio)) / 86400000 + 1;
        if (dias > MAX_DIAS)
            return res.status(400).json({ error: `El período admite hasta ${MAX_DIAS} días` });

        const cats = String(categorias || '').split(',')
            .map(v => parseInt(v.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);

        res.json(await reporteModel.obtenerInforme(id_sucursal, fecha_inicio, fecha_fin, cats.length ? cats : null));
    } catch (error) {
        console.error('Error en obtenerInforme:', error);
        res.status(500).json({ error: 'Error al generar el informe' });
    }
};

const obtenerDesgloseDia = async (req, res) => {
    try {
        const id_sucursal = sucursalPermitida(req);
        if (id_sucursal === null) return res.status(400).json({ error: 'Sucursal inválida' });
        const { fecha } = req.query;
        if (!fechaValida(fecha)) return res.status(400).json({ error: 'Fecha requerida en formato YYYY-MM-DD' });
        res.json(await reporteModel.obtenerDesgloseDia(id_sucursal, fecha));
    } catch (error) {
        console.error('Error en obtenerDesgloseDia:', error);
        res.status(500).json({ error: 'Error al obtener el desglose del día' });
    }
};

module.exports = { obtenerPanel, obtenerInforme, obtenerDesgloseDia };
