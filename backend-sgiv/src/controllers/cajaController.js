const cajaModel = require('../models/cajaModel');

const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal, id_usuario_cajero, monto_inicial } = req.body;
        const turno = await cajaModel.abrirTurno(id_sucursal, id_usuario_cajero, monto_inicial);
        res.status(201).json({ mensaje: 'Turno de caja abierto', turno });
    } catch (error) {
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
        res.status(500).json({ error: 'Error al registrar la venta. Verifique el stock o los datos.' });
    }
};

// NUEVO: Arqueo de caja
const obtenerArqueo = async (req, res) => {
    try {
        const id_sucursal = req.query.id_sucursal || 1;

        // Fechas por defecto: hoy
        const ahora = new Date();
        const fin = req.query.fecha_fin
            ? new Date(req.query.fecha_fin + 'T23:59:59')
            : new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59);

        const inicio = req.query.fecha_inicio
            ? new Date(req.query.fecha_inicio + 'T00:00:00')
            : new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0);

        const [ventas, resumen, porCategoria, porDia] = await Promise.all([
            cajaModel.obtenerVentasDetalladas(id_sucursal, inicio, fin),
            cajaModel.obtenerResumenPorPeriodo(id_sucursal, inicio, fin),
            cajaModel.obtenerVentasPorCategoria(id_sucursal, inicio, fin),
            cajaModel.obtenerVentasPorDia(id_sucursal, inicio, fin)
        ]);

        res.json({ ventas, resumen, por_categoria: porCategoria, por_dia: porDia });
    } catch (error) {
        console.error('Error en obtenerArqueo:', error);
        res.status(500).json({ error: 'Error al generar el arqueo de caja' });
    }
};

module.exports = { abrirCaja, cobrarVenta, obtenerArqueo };