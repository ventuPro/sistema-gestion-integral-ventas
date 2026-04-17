const reporteModel = require('../models/reporteModel');

const obtenerDashboard = async (req, res) => {
    try {
        const { id_sucursal } = req.params;

        // Ejecutamos las 3 consultas al mismo tiempo para que sea más rápido usando Promise.all
        const [resumenDiario, topProductos, alertasStock] = await Promise.all([
            reporteModel.obtenerResumenDiario(id_sucursal),
            reporteModel.obtenerTopProductos(id_sucursal),
            reporteModel.obtenerAlertasStock(id_sucursal)
        ]);

        // Empaquetamos todo en un solo objeto JSON
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

module.exports = { obtenerDashboard };