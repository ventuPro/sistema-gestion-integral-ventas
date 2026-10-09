const pedidoModel = require('../models/pedidoModel');
const cuentaModel = require('../models/cuentaModel');
const { emitirStock, emitirCajeros, emitirMesa } = require('../utils/tiempoReal');
const contexto    = require('../auditoria/contexto');
const ajusteModel = require('../models/ajusteModel');

// ─── Errores ───
const ERRORES = {
    PEDIDO_INVALIDO:      400,
    ULTIMO_PRODUCTO:      400,
    PEDIDO_NO_ENCONTRADO: 404,
    PEDIDO_YA_PROCESADO:  409,
    STOCK_INSUFICIENTE:   409
};
const responderError = (res, e, contexto) => {
    const status = ERRORES[e.code];
    if (status) return res.status(status).json({ error: e.message, codigo: e.code, estado_actual: e.estado_actual });
    console.error(`${contexto}:`, e);
    res.status(500).json({ error: 'Error al procesar el pedido' });
};

// Ajustes → Parámetros; MENU_MINUTOS_EXPIRACION lo reemplaza si está definido
const minutosExpiracion = async () =>
    Number(process.env.MENU_MINUTOS_EXPIRACION) || (await ajusteModel.parametros()).menu_minutos_expiracion;

// Admin: todas las sucursales
const sucursalFiltro = (req) => Number(req.usuario.id_rol) === 1 ? null : Number(req.usuario.id_sucursal);

const avisarCambio = (pedido, extra = {}) => {
    emitirCajeros('pedido:actualizado', {
        id_pedido: pedido.id_pedido, id_sucursal: pedido.id_sucursal,
        id_mesa: pedido.id_mesa, estado: pedido.estado_pedido, ...extra
    });
    emitirMesa(pedido.id_mesa, 'pedido:estado', { id_pedido: pedido.id_pedido, estado: pedido.estado_pedido });
};

// GET /api/pedidos/bandeja
const obtenerBandeja = async (req, res) => {
    try {
        const id_sucursal = sucursalFiltro(req) ?? (Number(req.query.id_sucursal) || Number(req.usuario.id_sucursal) || 1);
        res.json(await pedidoModel.obtenerBandeja(id_sucursal, await minutosExpiracion()));
    } catch (e) {
        responderError(res, e, 'obtenerBandeja');
    }
};

// PATCH /api/pedidos/:id_pedido/detalle/:id_detalle
const ajustarDetalle = async (req, res) => {
    try {
        const r = await pedidoModel.ajustarDetalle({
            id_pedido:   Number(req.params.id_pedido),
            id_detalle:  Number(req.params.id_detalle),
            cantidad:    req.body?.cantidad,
            id_sucursal: sucursalFiltro(req)
        });
        emitirStock(r.cambios);
        avisarCambio(r.pedido, { monto_total: r.monto_total });
        res.json({ mensaje: 'Pedido actualizado', monto_total: r.monto_total });
    } catch (e) {
        responderError(res, e, 'ajustarDetalle');
    }
};

// POST /api/pedidos/:id_pedido/confirmar
const confirmarPedido = async (req, res) => {
    try {
        const r = await pedidoModel.confirmarPedido({
            id_pedido:   Number(req.params.id_pedido),
            id_usuario:  req.usuario.id_usuario,
            id_sucursal: sucursalFiltro(req)
        });
        const cuenta = await cuentaModel.obtenerCuentaActiva(r.pedido.id_mesa);

        avisarCambio(r.pedido);
        if (r.cuenta_nueva) emitirCajeros('cuenta:abierta', { id_mesa: r.pedido.id_mesa, id_cuenta: r.id_cuenta });
        emitirCajeros('cuenta:qr_integrado', {
            id_mesa:         r.pedido.id_mesa,
            numero_mesa:     cuenta?.numero_mesa,
            id_cuenta:       r.id_cuenta,
            total_acumulado: cuenta?.total_acumulado,
            items:           cuenta?.items
        });
        emitirCajeros('mesa:actualizada', { id_mesa: r.pedido.id_mesa });
        emitirMesa(r.pedido.id_mesa, 'cuenta:actualizada', {});

        res.json({ mensaje: 'Pedido confirmado', pedido: r.pedido, id_cuenta: r.id_cuenta });
    } catch (e) {
        responderError(res, e, 'confirmarPedido');
    }
};

// POST /api/pedidos/:id_pedido/rechazar
const rechazarPedido = async (req, res) => {
    try {
        const r = await pedidoModel.rechazarPedido({
            id_pedido:   Number(req.params.id_pedido),
            id_usuario:  req.usuario.id_usuario,
            id_sucursal: sucursalFiltro(req)
        });
        emitirStock(r.cambios);
        avisarCambio(r.pedido);
        res.json({ mensaje: 'Pedido rechazado' });
    } catch (e) {
        responderError(res, e, 'rechazarPedido');
    }
};

// POST /api/pedidos/:id_pedido/entregado
const marcarEntregado = async (req, res) => {
    try {
        const pedido = await pedidoModel.marcarEntregado({
            id_pedido:   Number(req.params.id_pedido),
            id_sucursal: sucursalFiltro(req)
        });
        avisarCambio(pedido);
        res.json({ mensaje: 'Pedido entregado' });
    } catch (e) {
        responderError(res, e, 'marcarEntregado');
    }
};

// Revisa cada minuto los pedidos que nadie atendió
const CONTEXTO_EXPIRACION = { usuario: 'Sistema', origen: 'Proceso automático: vencimiento de pedidos' };

const iniciarExpiracion = () => setInterval(() => contexto.ejecutar({ ...CONTEXTO_EXPIRACION }, async () => {
    try {
        const r = await pedidoModel.expirarPendientes(await minutosExpiracion());
        emitirStock(r.cambios);
        r.pedidos.forEach(p => avisarCambio(p));
    } catch (e) {
        console.error('expirarPendientes:', e.message);
    }
}), 60_000).unref();

module.exports = { obtenerBandeja, ajustarDetalle, confirmarPedido, rechazarPedido, marcarEntregado, avisarCambio, iniciarExpiracion };
