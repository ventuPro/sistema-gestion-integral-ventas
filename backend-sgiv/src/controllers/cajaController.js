const cajaModel     = require('../models/cajaModel');
const sucursalModel = require('../models/sucursalModel');
const ajusteModel   = require('../models/ajusteModel');
const promocionModel = require('../models/promocionModel');
const reservaModel  = require('../models/reservaModel');
const db            = require('../config/db');
const { marcarEvento } = require('../auditoria/registroAcceso');
const { emitirUsuario, emitirCajeros, emitirStock } = require('../utils/tiempoReal');

// ─── ESTADO COMPLETO (la fuente de verdad para el front) ──────────
const getEstadoCompleto = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario) || req.usuario.id_usuario;
        const data = await cajaModel.obtenerEstadoCompleto(id_usuario);
        res.json(data);
    } catch (e) {
        console.error('getEstadoCompleto:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── ESTADO SIMPLE (legacy) ────────────────────────────────────────
const getEstadoCaja = async (req, res) => {
    try {
        const dato = await cajaModel.obtenerEstadoCaja(Number(req.params.id_usuario));
        res.json({ caja_habilitada: dato?.caja_habilitada ?? false });
    } catch (e) {
        console.error('getEstadoCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── CONTROL ADMIN: habilitar / deshabilitar caja ─────────────────
const habilitarCajaUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede habilitar la caja' });
        const r = await cajaModel.habilitarCaja(Number(req.params.id_usuario));
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        const msg = r.accion === 'TURNO_REABIERTO'
            ? 'Caja reabierta — el cajero ya puede vender nuevamente'
            : 'Caja habilitada';
        res.json({ mensaje: msg, usuario: r });
    } catch (e) {
        console.error('habilitarCaja:', e.message);
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'El cajero ya tiene un turno abierto.' });
        res.status(500).json({ error: e.message });
    }
};

const deshabilitarCajaUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede cerrar la caja' });
        const id_usuario = Number(req.params.id_usuario);
        const r = await cajaModel.deshabilitarCaja(id_usuario);
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        // Su Punto de venta y Mesas se bloquean al instante
        const { turnos, ...usuario } = r;
        for (const t of turnos) {
            const datos = { id_turno: t.id_turno, id_usuario, id_sucursal: t.id_sucursal, por: 'Administrador' };
            emitirUsuario(id_usuario, 'caja:cerrada', datos);
            emitirCajeros('caja:cerrada', datos);
        }
        emitirCajeros('cierres:actualizados', {});
        res.json({ mensaje: 'Caja cerrada', usuario });
    } catch (e) {
        console.error('deshabilitarCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── REAPERTURA EXPLÍCITA POR ADMIN ───────────────────────────────
const reabrirCajaAdmin = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede reabrir caja' });
        const id_usuario_cajero = Number(req.params.id_usuario);
        const turno = await cajaModel.reabrirTurno(id_usuario_cajero);
        emitirCajeros('cierres:actualizados', {});
        res.json({ mensaje: 'Caja reabierta correctamente', turno });
    } catch (e) {
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'El cajero ya tiene un turno abierto.' });
        if (e.message === 'NO_HAY_TURNO_CERRADO_HOY')
            return res.status(404).json({ error: 'No hay turno cerrado hoy para reabrir.' });
        console.error('reabrirCajaAdmin:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── TURNO ────────────────────────────────────────────────────────
const getTurnoHoy = async (req, res) => {
    try {
        const turno = await cajaModel.verificarTurnoHoy(req.usuario.id_usuario);
        res.json({ turno });
    } catch (e) {
        console.error('getTurnoHoy:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const abrirCaja = async (req, res) => {
    try {
        const { id_sucursal } = req.body;
        const monto_inicial = Number(req.body?.monto_inicial ?? 0);
        if (!Number.isFinite(monto_inicial) || monto_inicial < 0 || monto_inicial > 10000000)
            return res.status(400).json({ error: 'Fondo inicial inválido' });
        const sucursal = sucursalDe(req, id_sucursal);
        if (!(await sucursalModel.estaActiva(sucursal)))
            return res.status(400).json({ error: 'La sucursal está desactivada: no se puede abrir caja.' });
        const turno = await cajaModel.abrirTurno(
            sucursal,
            req.usuario.id_usuario,
            Math.round(monto_inicial * 100) / 100
        );
        res.status(201).json({ mensaje: 'Turno abierto', turno });
    } catch (e) {
        if (e.message === 'YA_TIENE_TURNO_ABIERTO')
            return res.status(400).json({ error: 'Ya tienes un turno abierto.' });
        console.error('abrirCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const cerrarCaja = async (req, res) => {
    try {
        const { id_sucursal, efectivo_contado } = req.body;
        let contado = null;
        if (efectivo_contado !== undefined && efectivo_contado !== null && efectivo_contado !== '') {
            contado = Number(efectivo_contado);
            if (!Number.isFinite(contado) || contado < 0 || contado > 10000000)
                return res.status(400).json({ error: 'Efectivo contado inválido' });
            contado = Math.round(contado * 100) / 100;
        }
        const r = await cajaModel.cerrarCaja(
            Number(id_sucursal) || req.usuario.id_sucursal,
            req.usuario.id_usuario,
            contado
        );
        emitirCajeros('cierres:actualizados', {});
        res.json(r);
    } catch (e) {
        console.error('cerrarCaja:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── ARQUEO / VENTAS ──────────────────────────────────────────────
const getArqueoHoy = async (req, res) => {
    try {
        const data = await cajaModel.obtenerArqueoHoy(
            Number(req.params.id_sucursal),
            req.usuario.id_usuario
        );
        res.json(data);
    } catch (e) {
        console.error('getArqueoHoy:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Reimprimir el comprobante de una venta (el cajero, solo de su sucursal) ───
const getComprobante = async (req, res) => {
    try {
        const id_venta = Number(req.params.id_venta);
        if (!Number.isInteger(id_venta) || id_venta < 1) return res.status(400).json({ error: 'Venta inválida.' });
        const esAdmin = Number(req.usuario.id_rol) === 1;
        const comprobante = await cajaModel.obtenerComprobante(id_venta, esAdmin ? null : Number(req.usuario.id_sucursal));
        if (!comprobante) return res.status(404).json({ error: 'No se encontró la venta.' });
        marcarEvento(res, 'REIMPRESION_COMPROBANTE', { id_venta });
        res.json(comprobante);
    } catch (e) {
        console.error('getComprobante:', e.message);
        res.status(500).json({ error: 'No se pudo obtener el comprobante.' });
    }
};

const getVentasHoyPOS = async (req, res) => {
    try {
        const ventas = await cajaModel.obtenerVentasHoyPOS(
            Number(req.params.id_sucursal),
            req.usuario.id_usuario
        );
        res.json(ventas);
    } catch (e) {
        console.error('getVentasHoyPOS:', e.message);
        res.status(500).json({ error: e.message });
    }
};

const getCierresCaja = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador' });
        const cierres = await cajaModel.obtenerCierresCaja();
        res.json(cierres);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const cobrarVenta = async (req, res) => {
    try {
        const datos = { ...req.body, id_usuario_cajero: req.usuario.id_usuario };
        const motivo = await ajusteModel.motivoMetodoPago(datos.metodo_pago);
        if (motivo) return res.status(400).json({ error: 'VENTA_INVALIDA', detalle: motivo });
        const { id_venta, numero_dia, cambiosStock, cotizacion } = await cajaModel.registrarVenta(datos);

        emitirStock(cambiosStock);
        emitirUsuario(req.usuario.id_usuario, 'ventas:actualizadas', {});

        res.status(201).json({ mensaje: 'Venta registrada', id_venta, numero_dia, cotizacion, stock: cambiosStock });
    } catch (e) {
        console.error('cobrarVenta:', e.message);
        if (e.message === 'CAJA_CERRADA')
            return res.status(403).json({
                error: 'CAJA_CERRADA',
                detalle: Number(req.usuario.id_rol) === 1
                    ? 'No tienes una caja abierta. Ábrela en «Punto de venta» para cobrar.'
                    : 'Tu caja está cerrada. Pide al administrador que la reabra.'
            });
        if (e.code === 'STOCK_INSUFICIENTE')
            return res.status(409).json({ error: 'STOCK_INSUFICIENTE', detalle: e.message });
        if (e.code === 'PRECIO_DESACTUALIZADO')
            return res.status(409).json({ error: 'PRECIO_DESACTUALIZADO', detalle: e.message, precios: e.precios,
                                          total: e.total, cotizacion: e.cotizacion });
        if (e.code === 'DESCUENTO_INVALIDO')
            return res.status(400).json({ error: 'DESCUENTO_INVALIDO', detalle: e.message });
        if (e.code === 'VENTA_INVALIDA')
            return res.status(400).json({ error: 'VENTA_INVALIDA', detalle: e.message });
        res.status(500).json({ error: 'Error al registrar la venta.', detalle: e.message });
    }
};

// ─── Carrito de caja: lo agregado se reserva al momento ───
// GET /caja/reservas — para rearmar el carrito al volver a Punto de venta
const getReservas = async (req, res) => {
    try { res.json(await reservaModel.activas(req.usuario.id_usuario)); }
    catch (e) { console.error('getReservas:', e.message); res.status(500).json({ error: 'No se pudo leer el carrito' }); }
};

// PUT /caja/reservas/:id_producto { cantidad } — 0 = quitar del carrito
const putReserva = async (req, res) => {
    try {
        const id_producto = Number(req.params.id_producto), cantidad = Number(req.body?.cantidad);
        if (!Number.isInteger(id_producto) || id_producto < 1 || !Number.isInteger(cantidad) || cantidad < 0 || cantidad > 10000)
            return res.status(400).json({ error: 'Cantidad inválida' });
        const r = await reservaModel.fijar({ id_usuario: req.usuario.id_usuario, id_producto, cantidad });
        emitirStock(r.cambios);
        res.json({ cantidad: r.cantidad, stock: r.stock });
    } catch (e) {
        if (e.code === 'CAJA_CERRADA')       return res.status(403).json({ error: 'CAJA_CERRADA', detalle: 'La caja está cerrada' });
        if (e.code === 'STOCK_INSUFICIENTE') return res.status(409).json({ error: 'STOCK_INSUFICIENTE', maximo: e.maximo });
        if (e.code === 'NO_DISPONIBLE')      return res.status(409).json({ error: 'NO_DISPONIBLE', maximo: 0 });
        console.error('putReserva:', e.message);
        res.status(500).json({ error: 'No se pudo reservar' });
    }
};

/** Sucursal de trabajo: el administrador puede pedir otra; el cajero usa la suya */
const sucursalDe = (req, pedida) => Number(req.usuario.id_rol) === 1
    ? Number(pedida) || Number(req.usuario.id_sucursal)
    : Number(req.usuario.id_sucursal);

/** Con caja abierta se cotiza en la sucursal del turno (la misma con la que se cobra) */
const sucursalVenta = async (req, pedida) => {
    const r = await db.query(
        `SELECT id_sucursal FROM turno_caja WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
         ORDER BY fecha_hora_apertura DESC LIMIT 1`, [req.usuario.id_usuario]);
    return Number(r.rows[0]?.id_sucursal) || sucursalDe(req, pedida);
};

// GET /api/caja/promociones-vigentes?id_sucursal=  etiquetas del catálogo del punto de venta
const promocionesVigentes = async (req, res) => {
    try {
        const lista = await promocionModel.vigentes(db, await sucursalVenta(req, req.query.id_sucursal));
        res.json(lista.map(p => ({ ...p, productos: p.productos.map(x => x.id_producto) })));
    } catch (e) {
        console.error('promocionesVigentes:', e.message);
        res.status(500).json({ error: 'No se pudieron cargar las promociones.' });
    }
};

// POST /api/caja/cotizar { detalles, descuento? }: precios con promociones (no registra nada)
const cotizarVenta = async (req, res) => {
    const client = await db.connect();
    try {
        const id_sucursal = await sucursalVenta(req, req.body?.id_sucursal);
        const items = await cajaModel.calcularItemsVenta(client, req.body?.detalles);
        const cot = await promocionModel.cotizar(client, {
            id_sucursal,
            lineas: items.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria,
                                      cantidad: i.cantidad, precioCentavos: Math.round(i.precio * 100) })),
            descuento: req.body?.descuento || null
        });
        res.json(promocionModel.enBolivianos(cot));
    } catch (e) {
        if (e.code === 'VENTA_INVALIDA' || e.code === 'DESCUENTO_INVALIDO')
            return res.status(400).json({ error: e.code, detalle: e.message });
        console.error('cotizarVenta:', e.message);
        res.status(500).json({ error: 'No se pudo calcular el total.' });
    } finally {
        client.release();
    }
};

// ─── ESTADO PARA PANEL PRINCIPAL ─────────────────────────────────
const getEstadoCajaSucursal = async (req, res) => {
    try {
        const r = await cajaModel.obtenerEstadoCajaSucursal(Number(req.params.id_sucursal));
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getEstadoCaja, getEstadoCompleto,
    habilitarCajaUsuario, deshabilitarCajaUsuario, reabrirCajaAdmin,
    getTurnoHoy, abrirCaja, cerrarCaja,
    getArqueoHoy, getVentasHoyPOS, getComprobante, getCierresCaja, cobrarVenta, cotizarVenta, promocionesVigentes,
    getEstadoCajaSucursal, getReservas, putReserva
};
