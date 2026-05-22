const reporteModel = require('../models/reporteModel');

// Dashboard antiguo (mantener compatibilidad)
const obtenerDashboard = async (req, res) => {
    try {
        const { id_sucursal } = req.params;
        const [resumenDiario, topProductos, alertasStock] = await Promise.all([
            reporteModel.obtenerResumenDiario(id_sucursal),
            reporteModel.obtenerTopProductos(id_sucursal),
            reporteModel.obtenerAlertasStock(id_sucursal)
        ]);
        res.json({
            resumen_diario: {
                total_ventas:     parseInt(resumenDiario.total_ventas),
                ingresos_totales: parseFloat(resumenDiario.ingresos_totales)
            },
            top_productos: topProductos,
            alertas_stock: alertasStock
        });
    } catch (error) {
        console.error('Error en obtenerDashboard:', error);
        res.status(500).json({ error: 'Error al generar los reportes del dashboard' });
    }
};

// Dashboard completo (nuevo)
const obtenerDashboardCompleto = async (req, res) => {
    try {
        const id_sucursal  = req.params.id_sucursal || 1;
        const id_categoria = req.query.categoria || null;
        const datos = await reporteModel.obtenerDashboardCompleto(id_sucursal, id_categoria);
        res.json(datos);
    } catch (error) {
        console.error('Error en obtenerDashboardCompleto:', error);
        res.status(500).json({ error: 'Error al generar el dashboard' });
    }
};

// Reporte por período — FIX fechas
const obtenerReportePeriodo = async (req, res) => {
    try {
        const { id_sucursal = 1 } = req.params;
        const { fecha_inicio, fecha_fin, categorias } = req.query;

        const ahora = new Date();
        // FIX: construir fechas correctas con timezone local
        const inicio = fecha_inicio
            ? new Date(fecha_inicio + 'T00:00:00')
            : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const fin = fecha_fin
            ? new Date(fecha_fin + 'T23:59:59')
            : ahora;

        const cats = (() => {
            if (!categorias) return null;
            const raw = Array.isArray(categorias) ? categorias : String(categorias).split(',');
            const ids = raw.map(v => parseInt(String(v).trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
            return ids.length > 0 ? ids : null;
        })();

        const datos = await reporteModel.obtenerReportePorPeriodo(id_sucursal, inicio, fin, cats);
        res.json(datos);
    } catch (error) {
        console.error('Error en obtenerReportePeriodo:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
};

const obtenerDesgloseDia = async (req, res) => {
    try {
        const { id_sucursal = 1 } = req.params;
        const { fecha } = req.query;
        if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return res.status(400).json({ error: 'Fecha requerida en formato YYYY-MM-DD' });
        }
        const datos = await reporteModel.obtenerDesgloseDia(id_sucursal, fecha);
        res.json(datos);
    } catch (error) {
        console.error('Error en obtenerDesgloseDia:', error);
        res.status(500).json({ error: 'Error al obtener el desglose del día' });
    }
};

module.exports = { obtenerDashboard, obtenerDashboardCompleto, obtenerReportePeriodo, obtenerDesgloseDia };