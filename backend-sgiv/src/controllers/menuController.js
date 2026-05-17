const db = require('../config/db');
const pm = require('../models/pedidoModel');

// ─── Middleware CORS para rutas públicas ───
const setCorsPublico = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// GET /api/menu/mesa/:id_mesa — info de la mesa (público)
const obtenerInfoMesa = async (req, res) => {
    setCorsPublico(res);
    try {
        const id_mesa = Number(req.params.id_mesa);
        if (!id_mesa) return res.status(400).json({ error: 'ID de mesa inválido' });

        const r = await db.query(`
            SELECT m.id_mesa, m.numero_mesa, m.estado_mesa, m.id_sucursal,
                   s.nombre_sucursal
            FROM mesa_local m
            JOIN sucursal   s ON m.id_sucursal = s.id_sucursal
            WHERE m.id_mesa = $1
        `, [id_mesa]);

        if (!r.rows.length)
            return res.status(404).json({ error: 'Mesa no encontrada' });

        res.json(r.rows[0]);
    } catch (e) {
        console.error('obtenerInfoMesa error:', e.message);
        res.status(500).json({ error: 'Error al obtener información de la mesa' });
    }
};

// GET /api/menu/catalogo?id_sucursal=1 — catálogo de la sucursal (público)
const obtenerCatalogoPublico = async (req, res) => {
    setCorsPublico(res);
    try {
        const id_sucursal = Number(req.query.id_sucursal) || 1;

        const r = await db.query(`
            SELECT
                p.id_producto,
                p.nombre_producto,
                p.descripcion_producto,
                p.precio_unitario,
                p.url_imagen,
                c.id_categoria,
                c.nombre_categoria,
                COALESCE(i.cantidad_actual, 0) AS stock_actual
            FROM producto p
            JOIN  categoria_producto    c ON p.id_categoria  = c.id_categoria
            LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto
                                            AND i.id_sucursal = $1
            WHERE p.estado_activo = TRUE
              AND COALESCE(i.cantidad_actual, 0) > 0
            ORDER BY c.nombre_categoria, p.nombre_producto
        `, [id_sucursal]);

        res.json(r.rows);
    } catch (e) {
        console.error('obtenerCatalogoPublico error:', e.message);
        res.status(500).json({ error: 'Error al obtener el catálogo' });
    }
};

// POST /api/menu/pedido — crear pedido desde el menú digital (público)
const crearPedidoDesdeMenu = async (req, res) => {
    setCorsPublico(res);
    try {
        const { id_mesa, numero_mesa, observacion_general, items } = req.body;

        // Validaciones
        if (!id_mesa)       return res.status(400).json({ error: 'Falta id_mesa' });
        if (!items || !items.length)
            return res.status(400).json({ error: 'El carrito está vacío' });

        // Validar que la mesa existe
        const rMesa = await db.query(
            `SELECT id_mesa, numero_mesa FROM mesa_local WHERE id_mesa = $1`,
            [id_mesa]
        );
        if (!rMesa.rows.length)
            return res.status(404).json({ error: 'Mesa no encontrada' });

        // Crear el pedido
        const pedido = await pm.crearPedido({
            id_mesa:             Number(id_mesa),
            observacion_general: observacion_general || null
        });

        // Agregar cada ítem del carrito
        for (const item of items) {
            await pm.agregarDetallePedido(
                pedido.id_pedido,
                Number(item.id_producto),
                Number(item.cantidad),
                Number(item.precio_unitario),
                item.nota_cliente || null
            );
        }

        // Obtener el monto total actualizado
        const rTotal = await db.query(
            `SELECT monto_total FROM pedido_mesa WHERE id_pedido = $1`,
            [pedido.id_pedido]
        );
        const monto_total = rTotal.rows[0]?.monto_total || 0;

        // Notificar a cajeros por Socket.IO
        const io = global.io;
        if (io) {
            io.to('cajeros').emit('nuevo_pedido_pendiente', {
                id_pedido:   pedido.id_pedido,
                id_mesa:     Number(id_mesa),
                numero_mesa: numero_mesa || rMesa.rows[0].numero_mesa,
                monto_total,
                items
            });
        }

        console.log(`✅ Pedido #${pedido.id_pedido} creado para Mesa ${numero_mesa}`);
        res.status(201).json({
            mensaje:   'Pedido enviado correctamente',
            id_pedido: pedido.id_pedido,
            monto_total
        });
    } catch (e) {
        console.error('crearPedidoDesdeMenu error:', e.message);
        res.status(500).json({ error: `Error al crear el pedido: ${e.message}` });
    }
};

// GET /api/menu/pedido/:id_pedido — estado del pedido (público)
const estadoPedido = async (req, res) => {
    setCorsPublico(res);
    try {
        const r = await db.query(
            `SELECT id_pedido, estado_pedido, monto_total, id_mesa FROM pedido_mesa WHERE id_pedido = $1`,
            [req.params.id_pedido]
        );
        if (!r.rows.length)
            return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(r.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// OPTIONS — preflight CORS para peticiones desde el celular
const handleOptions = (req, res) => {
    setCorsPublico(res);
    res.status(200).end();
};

module.exports = {
    obtenerInfoMesa,
    obtenerCatalogoPublico,
    crearPedidoDesdeMenu,
    estadoPedido,
    handleOptions
};