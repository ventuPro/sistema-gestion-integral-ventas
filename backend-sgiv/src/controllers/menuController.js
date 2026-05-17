const db = require('../config/db');
const pm = require('../models/pedidoModel');

const obtenerInfoMesa = async (req, res) => {
    // Headers para acceso público (el celular del cliente)
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const r = await db.query(`
            SELECT m.id_mesa, m.numero_mesa, m.estado_mesa, m.id_sucursal,
                   s.nombre_sucursal
            FROM mesa_local m
            JOIN sucursal s ON m.id_sucursal=s.id_sucursal
            WHERE m.id_mesa=$1
        `, [req.params.id_mesa]);
        if (!r.rows.length) return res.status(404).json({ error: 'Mesa no encontrada' });
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const obtenerCatalogoPublico = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const id_sucursal = Number(req.query.id_sucursal) || 1;
        const r = await db.query(`
            SELECT p.id_producto, p.nombre_producto, p.descripcion_producto,
                   p.precio_unitario, p.url_imagen,
                   c.id_categoria, c.nombre_categoria,
                   COALESCE(i.cantidad_actual, 0) AS stock_actual
            FROM producto p
            JOIN  categoria_producto    c ON p.id_categoria=c.id_categoria
            LEFT JOIN inventario_sucursal i ON p.id_producto=i.id_producto AND i.id_sucursal=$1
            WHERE p.estado_activo=TRUE AND COALESCE(i.cantidad_actual,0) > 0
            ORDER BY c.nombre_categoria, p.nombre_producto
        `, [id_sucursal]);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const crearPedidoDesdeMenu = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const { id_mesa, numero_mesa, observacion_general, items } = req.body;
        if (!items?.length) return res.status(400).json({ error: 'El pedido no tiene productos' });

        const pedido = await pm.crearPedido({ id_mesa, observacion_general: observacion_general || null });
        for (const item of items) {
            await pm.agregarDetallePedido(
                pedido.id_pedido, item.id_producto,
                item.cantidad, item.precio_unitario, item.nota_cliente || ''
            );
        }

        const rPedido = await db.query(`SELECT monto_total FROM pedido_mesa WHERE id_pedido=$1`, [pedido.id_pedido]);
        const io = global.io;
        io?.to('cajeros').emit('nuevo_pedido_pendiente', {
            id_pedido:   pedido.id_pedido,
            id_mesa,
            numero_mesa,
            monto_total: rPedido.rows[0]?.monto_total || 0,
            items
        });

        res.status(201).json({ mensaje: 'Pedido enviado', id_pedido: pedido.id_pedido });
    } catch(e) {
        console.error('crearPedidoDesdeMenu:', e);
        res.status(500).json({ error: e.message });
    }
};

const estadoPedido = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const r = await pm.obtenerEstadoPedidoPublico(req.params.id_pedido);
        res.json(r);
    } catch(e) { res.status(500).json({ error: e.message }); }
};

module.exports = { obtenerInfoMesa, obtenerCatalogoPublico, crearPedidoDesdeMenu, estadoPedido };