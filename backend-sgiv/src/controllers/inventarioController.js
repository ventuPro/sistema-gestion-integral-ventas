const inventarioModel = require('../models/inventarioModel');

const agregarMovimiento = async (req, res) => {
    try {
        const { id_sucursal, id_producto, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento } = req.body;

        // Validaciones básicas
        if (!['INGRESO', 'SALIDA'].includes(tipo_movimiento)) {
            return res.status(400).json({ error: 'tipo_movimiento debe ser INGRESO o SALIDA' });
        }

        const resultado = await inventarioModel.registrarMovimiento({
            id_sucursal,
            id_producto,
            id_usuario,
            tipo_movimiento,
            cantidad_movida,
            motivo_movimiento
        });

        res.status(201).json({ 
            mensaje: 'Movimiento de inventario registrado con éxito', 
            stock_actual: resultado.cantidad_actual 
        });
    } catch (error) {
        console.error('Error en agregarMovimiento:', error);
        res.status(500).json({ error: 'Error al registrar el movimiento de inventario' });
    }
};

const consultarInventario = async (req, res) => {
    try {
        const { id_sucursal } = req.params; // Lo sacaremos de la URL
        const inventario = await inventarioModel.obtenerInventarioPorSucursal(id_sucursal);
        res.json(inventario);
    } catch (error) {
        console.error('Error en consultarInventario:', error);
        res.status(500).json({ error: 'Error al consultar el inventario' });
    }
};

module.exports = { agregarMovimiento, consultarInventario };