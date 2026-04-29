const reporteModel = require('../models/reporteModel');

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
                total_ventas: parseInt(resumenDiario.total_ventas),
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

// NUEVO: Reporte por período
const obtenerReportePeriodo = async (req, res) => {
    try {
        const { id_sucursal = 1 } = req.params;
        const { fecha_inicio, fecha_fin } = req.query;

        const fin = fecha_fin
            ? new Date(fecha_fin + 'T23:59:59')
            : new Date();
        const inicio = fecha_inicio
            ? new Date(fecha_inicio + 'T00:00:00')
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const datos = await reporteModel.obtenerReportePorPeriodo(id_sucursal, inicio, fin);
        res.json(datos);
    } catch (error) {
        console.error('Error en obtenerReportePeriodo:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
};

module.exports = { obtenerDashboard, obtenerReportePeriodo };