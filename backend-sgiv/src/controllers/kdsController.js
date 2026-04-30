const pedidoModel = require('../models/pedidoModel');

// Cocina: obtener todos sus pedidos activos
const obtenerPedidosKDS = async (req, res) => {
    try {
        const id_sucursal = req.query.id_sucursal || req.usuario.id_sucursal || 1;
        const pedidos     = await pedidoModel.obtenerPedidosKDS(id_sucursal);
        res.json(pedidos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener pedidos de cocina' });
    }
};

// Cocina: cambiar estado de un ítem
const actualizarItemKDS = async (req, res) => {
    try {
        const { id_detalle }  = req.params;
        const { nuevo_estado } = req.body;

        const resultado = await pedidoModel.actualizarEstadoCocinaItem(id_detalle, nuevo_estado);
        if (!resultado) return res.status(404).json({ error: 'Ítem no encontrado' });

        // Emitir actualización en tiempo real
        if (global.io) {
            const { id_pedido, pedido_listo } = resultado;

            // Notificar al panel de cajeros
            global.io.to('cajeros').emit('item_cocina_actualizado', {
                id_detalle, id_pedido, nuevo_estado, pedido_listo
            });

            // Si el pedido está listo, notificar a la mesa del cliente
            if (pedido_listo) {
                // Buscar id_mesa
                const { db } = require('../config/db');
                // Hacemos una query simple
                const { Pool } = require('pg');
                const pool = require('../config/db');
                const r = await pool.query(
                    `SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1`, [id_pedido]
                );
                if (r.rows[0]) {
                    global.io.to(`mesa_${r.rows[0].id_mesa}`).emit('pedido_listo', {
                        id_pedido, mensaje: '🎉 Tu pedido está listo'
                    });
                }
            }
        }

        res.json({ mensaje: 'Estado actualizado', resultado });
    } catch (error) {
        console.error('Error actualizarItemKDS:', error);
        res.status(500).json({ error: error.message || 'Error al actualizar estado' });
    }
};

module.exports = { obtenerPedidosKDS, actualizarItemKDS };