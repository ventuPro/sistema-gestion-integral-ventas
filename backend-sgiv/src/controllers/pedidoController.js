const pedidoModel = require('../models/pedidoModel');

// ─── MESAS (CRUD) ───
const agregarMesa = async (req, res) => {
    try {
        const { id_sucursal = 1, numero_mesa } = req.body;
        const codigo_qr = `QR-SUC${id_sucursal}-MESA${numero_mesa}-${Date.now()}`;
        const mesa = await pedidoModel.crearMesa(id_sucursal, numero_mesa, codigo_qr);
        res.status(201).json({ mensaje: 'Mesa registrada', mesa });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar la mesa' });
    }
};

const listarMesas = async (req, res) => {
    try {
        const { id_sucursal } = req.params;
        const mesas = await pedidoModel.obtenerMesasPorSucursal(id_sucursal);
        res.json(mesas);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las mesas' });
    }
};

// ─── PEDIDOS (CLIENTE → CAJERO → COCINA) ───

// Cliente abre pedido desde QR
const abrirPedido = async (req, res) => {
    try {
        const { id_mesa, observacion_general } = req.body;
        if (!id_mesa) return res.status(400).json({ error: 'id_mesa requerido' });
        const pedido = await pedidoModel.crearPedido(id_mesa, observacion_general || '');

        // Notificar a cajeros en tiempo real
        if (global.io) {
            global.io.to('cajeros').emit('nuevo_pedido_pendiente', {
                id_pedido:     pedido.id_pedido,
                id_mesa,
                fecha_pedido:  pedido.fecha_pedido
            });
        }

        res.status(201).json({ mensaje: 'Pedido creado. Agrega productos.', pedido });
    } catch (error) {
        console.error('Error abrirPedido:', error);
        res.status(500).json({ error: 'Error al iniciar el pedido' });
    }
};

// Cliente agrega producto al pedido
const agregarProductoPedido = async (req, res) => {
    try {
        const { id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente } = req.body;
        const detalle = await pedidoModel.agregarDetallePedido(
            id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente
        );
        res.status(201).json({ mensaje: 'Producto agregado', detalle });
    } catch (error) {
        res.status(500).json({ error: 'Error al agregar producto' });
    }
};

// Cliente: ver estado de su pedido
const verEstadoPedido = async (req, res) => {
    try {
        const { id_pedido } = req.params;
        const pedido = await pedidoModel.obtenerEstadoPedidoPublico(id_pedido);
        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(pedido);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el pedido' });
    }
};

// CAJERO: Ver pedidos pendientes de aprobación
const listarPendientesCajero = async (req, res) => {
    try {
        const id_sucursal = req.params.id_sucursal || req.usuario.id_sucursal || 1;
        const pedidos = await pedidoModel.obtenerPedidosPendientesCajero(id_sucursal);
        res.json(pedidos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener pedidos pendientes' });
    }
};

// CAJERO: Aprobar pedido → va a cocina
const aprobarPedido = async (req, res) => {
    try {
        const { id_pedido } = req.params;
        const pedido = await pedidoModel.aprobarPedido(id_pedido);

        // Notificar a cocina
        if (global.io) {
            const pedidoCompleto = await pedidoModel.obtenerPedidoCompleto(id_pedido);
            global.io.to('cocina').emit('nuevo_pedido_cocina', pedidoCompleto);
            global.io.to(`mesa_${pedidoCompleto.id_mesa}`).emit('pedido_aprobado', {
                id_pedido, estado: 'En_Cocina'
            });
        }

        res.json({ mensaje: 'Pedido aprobado y enviado a cocina', pedido });
    } catch (error) {
        res.status(500).json({ error: 'Error al aprobar pedido' });
    }
};

// CAJERO: Rechazar pedido
const rechazarPedido = async (req, res) => {
    try {
        const { id_pedido } = req.params;
        const resultado = await pedidoModel.rechazarPedido(id_pedido);

        if (global.io) {
            global.io.to(`pedido_${id_pedido}`).emit('pedido_rechazado', { id_pedido });
        }

        res.json({ mensaje: 'Pedido rechazado', resultado });
    } catch (error) {
        res.status(500).json({ error: 'Error al rechazar pedido' });
    }
};

module.exports = {
    agregarMesa, listarMesas,
    abrirPedido, agregarProductoPedido, verEstadoPedido,
    listarPendientesCajero, aprobarPedido, rechazarPedido
};