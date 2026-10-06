const pedidoModel = require('../models/pedidoModel');
const cuentaModel = require('../models/cuentaModel');
const io          = () => global.io;

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
        const pedido = await pedidoModel.crearPedido({ id_mesa, observacion_general });

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
        const id_pedido = Number(req.params.id_pedido);

        const faltantes = await pedidoModel.verificarStockPedido(id_pedido);
        if (faltantes.length > 0) {
            return res.status(409).json({
                error: 'Stock insuficiente: ' + faltantes
                    .map(f => `${f.nombre_producto} (pide ${f.solicitado}, hay ${f.disponible})`).join(', ')
            });
        }

        const pedido = await pedidoModel.aprobarPedido(id_pedido);
        if (!pedido) return res.status(409).json({ error: 'El pedido no existe o ya fue procesado' });

        // Integrar el pedido QR a la comanda de la mesa (se abre una si no existe),
        // así sus productos descuentan stock y se cobran al cerrar la cuenta.
        let cuenta = await cuentaModel.obtenerCuentaActiva(pedido.id_mesa);
        if (!cuenta) {
            await cuentaModel.abrirCuenta(pedido.id_mesa, req.usuario.id_usuario);
            cuenta = await cuentaModel.obtenerCuentaActiva(pedido.id_mesa);
        }
        const cuentaActualizada = await cuentaModel.integrarPedidoQR(cuenta.id_cuenta, id_pedido);
        io()?.to('cajeros').emit('cuenta:qr_integrado', {
            id_mesa:         pedido.id_mesa,
            numero_mesa:     cuenta.numero_mesa,
            id_cuenta:       cuenta.id_cuenta,
            total_acumulado: cuentaActualizada?.total_acumulado,
            items:           cuentaActualizada?.items
        });

        io()?.to('cocina').emit('nuevo_pedido_cocina', pedido);
        io()?.to(`mesa_${pedido.id_mesa}`).emit('pedido_aprobado', { id_pedido });
        io()?.to('cajeros').emit('mesa:actualizada', { id_mesa: pedido.id_mesa });

        res.json({ mensaje: 'Aprobado', pedido });
    } catch(e) {
        console.error('aprobarPedido:', e);
        res.status(500).json({ error: e.message });
    }
};

// CAJERO: Rechazar pedido
const rechazarPedido = async (req, res) => {
    try {
        const { id_pedido } = req.params;
        const resultado = await pedidoModel.rechazarPedido(id_pedido);

        if (global.io) {
            // El menú digital escucha en la sala de su mesa (mesa_<id>)
        if (resultado) global.io.to(`mesa_${resultado.id_mesa}`).emit('pedido_rechazado', { id_pedido });
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