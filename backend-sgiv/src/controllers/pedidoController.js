const pedidoModel = require('../models/pedidoModel');

// --- MESAS ---
const agregarMesa = async (req, res) => {
    try {
        const { id_sucursal, numero_mesa } = req.body;
        // Generamos un código QR ficticio por ahora (luego en Angular generaremos la imagen real)
        const codigo_qr = `QR-SUC${id_sucursal}-MESA${numero_mesa}-${Date.now()}`;
        
        const nuevaMesa = await pedidoModel.crearMesa(id_sucursal, numero_mesa, codigo_qr);
        res.status(201).json({ mensaje: 'Mesa registrada con éxito', mesa: nuevaMesa });
    } catch (error) {
        console.error('Error en agregarMesa:', error);
        res.status(500).json({ error: 'Error al registrar la mesa' });
    }
};

const listarMesas = async (req, res) => {
    try {
        const { id_sucursal } = req.params;
        const mesas = await pedidoModel.obtenerMesasPorSucursal(id_sucursal);
        res.json(mesas);
    } catch (error) {
        console.error('Error en listarMesas:', error);
        res.status(500).json({ error: 'Error al obtener las mesas' });
    }
};

// --- PEDIDOS ---
const abrirPedido = async (req, res) => {
    try {
        const { id_mesa } = req.body; // El cliente escanea el QR y envía su id_mesa
        const nuevoPedido = await pedidoModel.crearPedido(id_mesa);
        res.status(201).json({ mensaje: 'Pedido abierto. Ya puedes agregar productos.', pedido: nuevoPedido });
    } catch (error) {
        console.error('Error en abrirPedido:', error);
        res.status(500).json({ error: 'Error al iniciar el pedido' });
    }
};

const agregarProductoPedido = async (req, res) => {
    try {
        const { id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente } = req.body;
        const detalle = await pedidoModel.agregarDetallePedido(id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente);
        res.status(201).json({ mensaje: 'Producto agregado al pedido', detalle });
    } catch (error) {
        console.error('Error en agregarProductoPedido:', error);
        res.status(500).json({ error: 'Error al agregar producto al pedido' });
    }
};

module.exports = { agregarMesa, listarMesas, abrirPedido, agregarProductoPedido };