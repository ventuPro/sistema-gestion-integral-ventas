const db = require('../config/db');
const pedidoModel = require('../models/pedidoModel');

// Info de la mesa (para la cabecera del menú)
const obtenerInfoMesa = async (req, res) => {
    try {
        const { id_mesa } = req.params;
        const result = await db.query(
            `SELECT m.*, s.nombre_sucursal
             FROM mesa_local m
             JOIN sucursal s ON m.id_sucursal = s.id_sucursal
             WHERE m.id_mesa = $1;`,
            [id_mesa]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'Mesa no encontrada' });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener mesa' });
    }
};

// Catálogo público (solo productos visibles en menú con stock)
const obtenerCatalogoPublico = async (req, res) => {
    try {
        const id_sucursal = req.query.id_sucursal || 1;
        const result = await db.query(
            `SELECT p.id_producto, p.nombre_producto, p.descripcion_producto,
                    p.precio_unitario::numeric, p.url_imagen, p.mostrar_en_menu,
                    c.nombre_categoria, c.id_categoria,
                    COALESCE(i.cantidad_actual, 0) AS stock_actual
             FROM producto p
             LEFT JOIN categoria_producto c ON p.id_categoria = c.id_categoria
             LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto
                   AND i.id_sucursal = $1
             WHERE p.estado_activo = TRUE AND p.mostrar_en_menu = TRUE
               AND COALESCE(i.cantidad_actual, 0) > 0
             ORDER BY c.nombre_categoria ASC, p.nombre_producto ASC;`,
            [id_sucursal]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener catálogo' });
    }
};

// Crear pedido completo desde el menú digital
const crearPedidoDesdeMenu = async (req, res) => {
    try {
        const { id_mesa, items, observacion_general } = req.body;
        if (!id_mesa || !items || items.length === 0) {
            return res.status(400).json({ error: 'Datos del pedido incompletos' });
        }

        // 1. Crear pedido
        const pedido = await pedidoModel.crearPedido(id_mesa, observacion_general || '');

        // 2. Agregar todos los ítems
        for (const item of items) {
            await pedidoModel.agregarDetallePedido(
                pedido.id_pedido, item.id_producto,
                item.cantidad, item.precio_unitario, item.nota_cliente || ''
            );
        }

        // 3. Notificar a cajeros
        if (global.io) {
            global.io.to('cajeros').emit('nuevo_pedido_pendiente', {
                id_pedido:    pedido.id_pedido,
                id_mesa,
                numero_mesa:  req.body.numero_mesa || '?',
                total_items:  items.length,
                fecha_pedido: pedido.fecha_pedido
            });
        }

        res.status(201).json({
            mensaje: 'Pedido enviado. Un cajero lo revisará en breve.',
            id_pedido: pedido.id_pedido
        });
    } catch (error) {
        console.error('Error crearPedidoDesdeMenu:', error);
        res.status(500).json({ error: 'Error al crear el pedido' });
    }
};

// Estado del pedido (polling del cliente)
const estadoPedido = async (req, res) => {
    try {
        const { id_pedido } = req.params;
        const pedido = await pedidoModel.obtenerEstadoPedidoPublico(id_pedido);
        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(pedido);
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar pedido' });
    }
};

module.exports = { obtenerInfoMesa, obtenerCatalogoPublico, crearPedidoDesdeMenu, estadoPedido };