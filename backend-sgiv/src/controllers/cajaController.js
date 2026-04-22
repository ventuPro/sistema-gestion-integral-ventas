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
        // 1. Interceptamos los datos del carrito que vienen de Angular
        const datosVenta = req.body;

        // 2.Sobreescribimos cualquier ID falso e inyectamos el ID real del cajero logueado
        // Nota: Asumo que en tu Token guardaste el ID como "id_usuario". Si lo guardaste solo como "id", cámbialo a req.usuario.id
        datosVenta.id_usuario_cajero = req.usuario.id_usuario; 

        // 3. Procesamos la venta con el modelo
        const id_venta = await cajaModel.registrarVenta(datosVenta);
        
        res.status(201).json({ mensaje: 'Venta registrada con éxito y stock descontado', id_venta });
    } catch (error) {
        console.error('Error en cobrarVenta:', error);
        res.status(500).json({ error: 'Error al registrar la venta. Verifique el stock o los datos.' });
    }
};

module.exports = { abrirCaja, cobrarVenta };