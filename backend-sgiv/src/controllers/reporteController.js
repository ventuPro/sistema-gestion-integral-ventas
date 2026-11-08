const reporteModel = require('../models/reporteModel');
const valoracionModel = require('../models/valoracionModel');

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
        res.json(await reporteModel.obtenerPanel(id_sucursal, id_categoria, Number(req.usuario.id_rol) === 1));
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

        res.json(await reporteModel.obtenerInforme(id_sucursal, fecha_inicio, fecha_fin, cats.length ? cats : null,
                                                   { conCostos: Number(req.usuario.id_rol) === 1 }));
    } catch (error) {
        console.error('Error en obtenerInforme:', error);
        res.status(500).json({ error: 'Error al generar el informe' });
    }
};

// ─── Inventario valorado y kardex: solo el administrador (muestran costos) ───
const soloAdmin = (req, res) => {
    if (Number(req.usuario.id_rol) === 1) return true;
    res.status(403).json({ error: 'Solo el administrador puede ver el inventario valorado y el kardex' });
    return false;
};

// Inventario valorado (fecha de corte; 0 = todas las sucursales)
const hoyLaPaz = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
const listaIds = (v) => String(v || '').split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);

const inventarioValorado = async (req, res) => {
    try {
        if (!soloAdmin(req, res)) return;
        const id_sucursal = sucursalPermitida(req);
        if (id_sucursal === null) return res.status(400).json({ error: 'Sucursal inválida' });
        const fecha = req.query.fecha || hoyLaPaz();
        if (!fechaValida(fecha)) return res.status(400).json({ error: 'La fecha debe tener el formato AAAA-MM-DD' });
        if (fecha > hoyLaPaz()) return res.status(400).json({ error: 'La fecha de corte no puede ser futura' });
        const cats = listaIds(req.query.categorias);
        res.json(await valoracionModel.inventarioValorado({ id_sucursal, fecha, categorias: cats.length ? cats : null }));
    } catch (error) {
        console.error('inventarioValorado:', error);
        res.status(500).json({ error: 'No se pudo calcular el inventario valorado' });
    }
};

// ─── Kardex de un producto en una sucursal ───
const kardex = async (req, res) => {
    try {
        if (!soloAdmin(req, res)) return;
        const id_sucursal = sucursalPermitida(req);
        if (!id_sucursal) return res.status(400).json({ error: 'Elige una sucursal' });
        const id_producto = Number(req.query.id_producto);
        if (!Number.isInteger(id_producto) || id_producto <= 0) return res.status(400).json({ error: 'Elige un producto' });
        const { fecha_inicio, fecha_fin } = req.query;
        if (!fechaValida(fecha_inicio) || !fechaValida(fecha_fin))
            return res.status(400).json({ error: 'Fechas requeridas en formato AAAA-MM-DD' });
        if (fecha_inicio > fecha_fin) return res.status(400).json({ error: 'La fecha de inicio no puede ser mayor a la final' });
        if ((Date.parse(fecha_fin) - Date.parse(fecha_inicio)) / 86400000 + 1 > MAX_DIAS)
            return res.status(400).json({ error: `El período admite hasta ${MAX_DIAS} días` });
        const r = await valoracionModel.kardex({ id_sucursal, id_producto, desde: fecha_inicio, hasta: fecha_fin });
        if (!r) return res.status(404).json({ error: 'El producto no está en esa sucursal' });
        res.json(r);
    } catch (error) {
        console.error('kardex:', error);
        res.status(500).json({ error: 'No se pudo armar el kardex' });
    }
};

module.exports = { obtenerPanel, obtenerInforme, inventarioValorado, kardex };
