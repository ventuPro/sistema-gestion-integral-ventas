const pedidoModel = require('../models/pedidoModel');
const ajusteModel = require('../models/ajusteModel');
const { emitirStock, emitirCajeros, emitirMesa } = require('../utils/tiempoReal');

// ─── Menú digital público: la mesa se identifica por su código QR ───

// ─── Límite de pedidos por IP (Ajustes → Parámetros; MENU_MAX_PEDIDOS_IP lo reemplaza en pruebas) ───
const VENTANA_IP_MS    = 10 * 60 * 1000;
const pedidosPorIp     = new Map();   // ip → { cantidad, desde }

setInterval(() => {
    const ahora = Date.now();
    for (const [ip, r] of pedidosPorIp)
        if (ahora - r.desde > VENTANA_IP_MS) pedidosPorIp.delete(ip);
}, VENTANA_IP_MS).unref();

const superaLimiteIp = (ip, maximo) => {
    const r = pedidosPorIp.get(ip);
    if (!r || Date.now() - r.desde > VENTANA_IP_MS) {
        pedidosPorIp.set(ip, { cantidad: 1, desde: Date.now() });
        return false;
    }
    r.cantidad++;
    return r.cantidad > maximo;
};

const ERRORES = {
    PEDIDO_INVALIDO:        400,
    PEDIDO_NO_ENCONTRADO:   404,
    PEDIDO_YA_PROCESADO:    409,
    STOCK_INSUFICIENTE:     409,
    PRODUCTO_NO_DISPONIBLE: 409,
    NO_RECIBE_PEDIDOS:      409,
    DEMASIADOS_PENDIENTES:  429
};
const responderError = (res, e, contexto) => {
    const status = ERRORES[e.code];
    if (status) return res.status(status).json({
        error: e.message, codigo: e.code, id_producto: e.id_producto, disponible: e.disponible
    });
    console.error(`${contexto}:`, e);
    res.status(500).json({ error: 'No se pudo procesar tu solicitud. Intenta de nuevo.' });
};

// Middleware
const cargarMesa = async (req, res, next) => {
    try {
        const mesa = await pedidoModel.obtenerMesaPorCodigo(req.params.codigo);
        if (!mesa) return res.status(404).json({ error: 'Código QR no válido. Pide ayuda en caja.' });
        req.mesa = mesa;
        next();
    } catch (e) {
        responderError(res, e, 'cargarMesa');
    }
};

// GET /api/menu/m/:codigo
const obtenerMesa = async (req, res) => {
    try {
        const { numero_mesa, nombre_sucursal, id_sucursal, recibe_pedidos } = req.mesa;
        const { menu_activo } = await ajusteModel.parametros();
        res.json({ numero_mesa, nombre_sucursal, id_sucursal,
                   recibe_pedidos: recibe_pedidos && menu_activo, pedidos_desactivados: !menu_activo });
    } catch (e) {
        responderError(res, e, 'obtenerMesa');
    }
};

// GET /api/menu/m/:codigo/catalogo
const obtenerCatalogo = async (req, res) => {
    try {
        res.json(await pedidoModel.obtenerCatalogoMenu(req.mesa.id_sucursal));
    } catch (e) {
        responderError(res, e, 'obtenerCatalogo');
    }
};

// POST /api/menu/m/:codigo/pedidos
const crearPedido = async (req, res) => {
    try {
        const p = await ajusteModel.parametros();
        if (!p.menu_activo)
            return res.status(409).json({ error: 'Los pedidos desde el menú están desactivados. Pide en caja.', codigo: 'NO_RECIBE_PEDIDOS' });
        if (superaLimiteIp(req.ip, Number(process.env.MENU_MAX_PEDIDOS_IP) || p.menu_max_pedidos_ip))
            return res.status(429).json({ error: 'Hiciste muchos pedidos seguidos. Espera unos minutos o pide ayuda en caja.' });

        const { pedido, cambios } = await pedidoModel.crearPedidoMesa({
            mesa:                req.mesa,
            items:               req.body?.items,
            observacion_general: req.body?.observacion_general,
            maxPendientes:       p.menu_max_pendientes_mesa
        });

        emitirStock(cambios);
        emitirCajeros('pedido:nuevo', {
            id_pedido:   pedido.id_pedido,
            id_sucursal: pedido.id_sucursal,
            id_mesa:     pedido.id_mesa,
            numero_mesa: req.mesa.numero_mesa,
            monto_total: pedido.monto_total
        });

        res.status(201).json({
            mensaje:     'Pedido enviado. El cajero lo confirmará en breve.',
            id_pedido:   pedido.id_pedido,
            monto_total: pedido.monto_total
        });
    } catch (e) {
        responderError(res, e, 'crearPedido');
    }
};

// POST /api/menu/m/:codigo/pedidos/:id_pedido/cancelar
const cancelarPedido = async (req, res) => {
    try {
        const { pedido, cambios } = await pedidoModel.cancelarPorCliente({
            id_pedido: Number(req.params.id_pedido),
            id_mesa:   req.mesa.id_mesa
        });
        emitirStock(cambios);
        emitirCajeros('pedido:actualizado', {
            id_pedido: pedido.id_pedido, id_sucursal: pedido.id_sucursal,
            id_mesa: pedido.id_mesa, estado: pedido.estado_pedido
        });
        emitirMesa(pedido.id_mesa, 'pedido:estado', { id_pedido: pedido.id_pedido, estado: pedido.estado_pedido });
        res.json({ mensaje: 'Pedido cancelado' });
    } catch (e) {
        responderError(res, e, 'cancelarPedido');
    }
};

// GET /api/menu/m/:codigo/estado?ids=1,2,3
const obtenerEstado = async (req, res) => {
    try {
        const ids = String(req.query.ids || '')
            .split(',')
            .map(Number)
            .filter(n => Number.isInteger(n) && n > 0)
            .slice(0, 30);
        res.json(await pedidoModel.obtenerEstadoMesa(req.mesa.id_mesa, ids));
    } catch (e) {
        responderError(res, e, 'obtenerEstado');
    }
};

module.exports = { cargarMesa, obtenerMesa, obtenerCatalogo, crearPedido, cancelarPedido, obtenerEstado };
