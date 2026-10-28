const pedidoModel = require('../models/pedidoModel');
const ajusteModel = require('../models/ajusteModel');
const promocionModel = require('../models/promocionModel');
const cuentaModel = require('../models/cuentaModel');
const visitaModel = require('../models/visitaModel');
const { calcularItemsVenta } = require('../models/cajaModel');
const db = require('../config/db');
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
    BLOQUEADO:              403,
    ESPERA_VERIFICACION:    429,
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

// Código del celular (lo genera el navegador del cliente) y nombre opcional
const CLIENTE_MESA = /^[0-9a-f]{32}$/;
const clienteMesa  = (valor) => CLIENTE_MESA.test(String(valor || '')) ? String(valor) : null;
const nombreCliente = (valor) =>
    String(valor ?? '').replace(/[^\p{L}\s.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;

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

// ─── Visita: empieza al abrir el menú (escanear) y termina por tiempo, inactividad o al liberar la mesa ───
const MENSAJES_VISITA = {
    vencida:       'Tu visita terminó. Escanea el QR de tu mesa para pedir.',
    terminada:     'Tu visita terminó. Escanea el QR de tu mesa para pedir.',
    sin_qr_visita: 'Pide al personal el QR de tu visita para hacer pedidos.',
    bloqueado:     'No puedes hacer pedidos desde esta mesa por ahora. Pide ayuda en caja.'
};
const CODIGO_VISITA = /^[0-9a-f]{32}$/;

// POST /api/menu/m/:codigo/visita { cliente_mesa, visita?, v? }
// Sin `visita` empieza una nueva; con ella la renueva (actividad del cliente) si sigue vigente
const visita = async (req, res) => {
    try {
        const cliente = clienteMesa(req.body?.cliente_mesa);
        if (!cliente) return res.status(400).json({ error: 'Código de celular inválido' });
        const p = await ajusteModel.parametros();
        const mesa = req.mesa;

        let token;
        if (req.body?.visita) {
            const r = visitaModel.revisar(req.body.visita, mesa, p);
            if (r.datos?.c !== cliente || ['vencida', 'terminada'].includes(r.motivo)) {
                const motivo = r.datos?.c === cliente ? r.motivo : 'vencida';
                return res.json({ visita: null, motivo, mensaje: MENSAJES_VISITA[motivo] });
            }
            token = visitaModel.firmar({ ...r.datos, a: Date.now() });
        } else {
            const v = CODIGO_VISITA.test(String(req.body?.v || '')) ? String(req.body.v) : null;
            token = visitaModel.firmar({ m: mesa.id_mesa, c: cliente, i: Date.now(), v });
        }

        let motivo = visitaModel.revisar(token, mesa, p).motivo ?? null;
        if (!motivo && await visitaModel.estaBloqueado(db, mesa.id_mesa, cliente, req.ip)) motivo = 'bloqueado';
        res.json({ visita: token, motivo, mensaje: motivo ? MENSAJES_VISITA[motivo] : null,
                   inactividad_min: p.menu_visita_inactividad });
    } catch (e) {
        responderError(res, e, 'visita');
    }
};

// GET /api/menu/m/:codigo/catalogo
const obtenerCatalogo = async (req, res) => {
    try {
        const [catalogo, vigentes] = await Promise.all([
            pedidoModel.obtenerCatalogoMenu(req.mesa.id_sucursal),
            promocionModel.vigentes(db, req.mesa.id_sucursal)
        ]);
        res.json(catalogo.map(p => ({ ...p, promocion: promocionModel.promocionDeProducto(p, vigentes) })));
    } catch (e) {
        responderError(res, e, 'obtenerCatalogo');
    }
};

// GET /api/menu/m/:codigo/promociones  las vigentes ahora, con texto para el cliente
const obtenerPromociones = async (req, res) => {
    try {
        const { moneda_simbolo } = await ajusteModel.parametros();
        const lista = await promocionModel.vigentesDetalle(req.mesa.id_sucursal);
        res.json(lista.map(v => ({ nombre: v.nombre, tipo: v.tipo, valor: v.valor, lleva: v.lleva, paga: v.paga,
                                   texto: promocionModel.textoPromocion(v, moneda_simbolo) })));
    } catch (e) {
        responderError(res, e, 'obtenerPromociones');
    }
};

// POST /api/menu/m/:codigo/cotizar { items: [{ id_producto, cantidad }] }  total estimado del carrito
const cotizarCarrito = async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
        const lineas = await calcularItemsVenta(db, items);
        const cot = await promocionModel.cotizar(db, {
            id_sucursal: req.mesa.id_sucursal,
            lineas: lineas.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria,
                                       cantidad: i.cantidad, precioCentavos: Math.round(i.precio * 100) }))
        });
        res.json(promocionModel.enBolivianos(cot));
    } catch (e) {
        if (e.code === 'VENTA_INVALIDA') return res.status(400).json({ error: e.message });
        responderError(res, e, 'cotizarCarrito');
    }
};

// POST /api/menu/m/:codigo/pedidos
const crearPedido = async (req, res) => {
    try {
        const p = await ajusteModel.parametros();
        if (!p.menu_activo)
            return res.status(409).json({ error: 'Los pedidos desde el menú están desactivados. Pide en caja.', codigo: 'NO_RECIBE_PEDIDOS' });
        const v = visitaModel.revisar(req.body?.visita, req.mesa, p);
        if (!v.valida)
            return res.status(403).json({ error: MENSAJES_VISITA[v.motivo], codigo: 'VISITA_VENCIDA', motivo: v.motivo });
        if (superaLimiteIp(req.ip, Number(process.env.MENU_MAX_PEDIDOS_IP) || p.menu_max_pedidos_ip))
            return res.status(429).json({ error: 'Hiciste muchos pedidos seguidos. Espera unos minutos o pide ayuda en caja.' });

        const { pedido, cambios } = await pedidoModel.crearPedidoMesa({
            mesa:                req.mesa,
            items:               req.body?.items,
            observacion_general: req.body?.observacion_general,
            maxPendientes:       p.menu_max_pendientes_mesa,
            cliente_mesa:        v.datos.c,
            nombre_cliente:      nombreCliente(req.body?.nombre_cliente),
            ip_cliente:          String(req.ip || '').slice(0, 45) || null
        });

        emitirStock(cambios);
        emitirCajeros('pedido:nuevo', {
            id_pedido:   pedido.id_pedido,
            id_sucursal: pedido.id_sucursal,
            id_mesa:     pedido.id_mesa,
            numero_mesa: req.mesa.numero_mesa,
            nombre_cliente: pedido.nombre_cliente,
            monto_total: pedido.monto_total,
            sin_verificar: pedido.sin_verificar
        });

        res.status(201).json({
            mensaje:     'Pedido enviado. El cajero lo confirmará en breve.',
            id_pedido:   pedido.id_pedido,
            monto_total: pedido.monto_total,
            visita:      visitaModel.firmar({ ...v.datos, a: Date.now() })
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
            id_mesa:   req.mesa.id_mesa,
            cliente_mesa: clienteMesa(req.body?.cliente_mesa)
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

// GET /api/menu/m/:codigo/estado?cliente=<código del celular>
const obtenerEstado = async (req, res) => {
    try {
        const cliente = clienteMesa(req.query.cliente);
        const estado = await pedidoModel.obtenerEstadoMesa(req.mesa.id_mesa, cliente);
        // Lo que falta pagar, con las promociones vigentes (igual que se cobrará en caja)
        const c = estado.cuenta;
        if (c) {
            const [mio, mesa] = await Promise.all([
                cuentaModel.cotizarCuenta(c.id_cuenta, { cliente_mesa: cliente }),
                cuentaModel.cotizarCuenta(c.id_cuenta)
            ]);
            if (mio)  { c.mi_pendiente = mio.total; c.mi_descuento = mio.descuento_promociones; }
            if (mesa) c.total_mesa = mesa.total;
            delete c.id_cuenta;
        }
        res.json(estado);
    } catch (e) {
        responderError(res, e, 'obtenerEstado');
    }
};

module.exports = { cargarMesa, obtenerMesa, visita, obtenerCatalogo, obtenerPromociones, cotizarCarrito, crearPedido, cancelarPedido, obtenerEstado };
