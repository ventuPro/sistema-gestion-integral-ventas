const cajaModel     = require('../models/cajaModel');
const sucursalModel = require('../models/sucursalModel');
const ajusteModel   = require('../models/ajusteModel');
const promocionModel = require('../models/promocionModel');
const db            = require('../config/db');

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
        const r = await cajaModel.deshabilitarCaja(Number(req.params.id_usuario));
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ mensaje: 'Caja cerrada', usuario: r });
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
        const { id_sucursal, monto_inicial } = req.body;
        const sucursal = Number(id_sucursal) || req.usuario.id_sucursal;
        if (!(await sucursalModel.estaActiva(sucursal)))
            return res.status(400).json({ error: 'La sucursal está desactivada: no se puede abrir caja.' });
        const turno = await cajaModel.abrirTurno(
            sucursal,
            req.usuario.id_usuario,
            Number(monto_inicial) || 0
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
        const datos = { ...req.body, id_usuario_cajero: req.usuario.id_usuario,
                        maxDescuentoPct: await ajusteModel.topeDescuento(req.usuario) };
        const motivo = await ajusteModel.motivoMetodoPago(datos.metodo_pago);
        if (motivo) return res.status(400).json({ error: 'VENTA_INVALIDA', detalle: motivo });
        const { id_venta, cambiosStock, cotizacion } = await cajaModel.registrarVenta(datos);

        for (const c of cambiosStock) {
            global.io?.emit('actualizacion_stock_global', {
                id_producto:               c.id_producto,
                id_sucursal:               c.id_sucursal,
                nueva_cantidad_disponible: c.nuevo_stock
            });
        }

        res.status(201).json({ mensaje: 'Venta registrada', id_venta, cotizacion });
    } catch (e) {
        console.error('cobrarVenta:', e.message);
        if (e.message === 'CAJA_CERRADA')
            return res.status(403).json({
                error: 'CAJA_CERRADA',
                detalle: 'Tu caja está cerrada. Pide al administrador que la reabra.'
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

// POST /api/caja/cotizar { detalles, descuento? }: precios con promociones (no registra nada)
const cotizarVenta = async (req, res) => {
    const client = await db.connect();
    try {
        const id_sucursal = Number(req.usuario.id_rol) === 1
            ? Number(req.body?.id_sucursal) || Number(req.usuario.id_sucursal)
            : Number(req.usuario.id_sucursal);
        const descuento_max = await ajusteModel.topeDescuento(req.usuario);
        const items = await cajaModel.calcularItemsVenta(client, req.body?.detalles);
        const cot = await promocionModel.cotizar(client, {
            id_sucursal,
            lineas: items.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria,
                                      cantidad: i.cantidad, precioCentavos: Math.round(i.precio * 100) })),
            descuento: req.body?.descuento || null, maxManualPct: descuento_max
        });
        res.json({ ...promocionModel.enBolivianos(cot), descuento_max });
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
    getArqueoHoy, getVentasHoyPOS, getCierresCaja, cobrarVenta, cotizarVenta,
    getEstadoCajaSucursal
};
