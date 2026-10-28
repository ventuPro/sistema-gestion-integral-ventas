const cuentaModel  = require('../models/cuentaModel');
const productoModel = require('../models/productoModel');
const mesaModel    = require('../models/mesaModel');
const ajusteModel  = require('../models/ajusteModel');
const { emitirMesa } = require('../utils/tiempoReal');
const io           = () => global.io;

// POST /api/cuentas/abrir
const abrirCuenta = async (req, res) => {
    try {
        const { id_mesa } = req.body;
        const id_usuario  = req.usuario.id_usuario;

        const cuenta = await cuentaModel.abrirCuenta(id_mesa, id_usuario);

        io()?.to('cajeros').emit('cuenta:abierta', {
            id_mesa, id_cuenta: cuenta.id_cuenta
        });
        io()?.to('cajeros').emit('mesa:actualizada', { id_mesa });

        res.status(201).json({ mensaje: 'Mesa abierta', cuenta });
    } catch(e) {
        if (e.message === 'CUENTA_YA_ABIERTA')
            return res.status(409).json({ error: 'La mesa ya tiene una cuenta abierta' });
        console.error('abrirCuenta:', e);
        res.status(500).json({ error: 'Error al abrir la mesa' });
    }
};

// GET /api/cuentas/mesa/:id_mesa
const getCuentaActiva = async (req, res) => {
    try {
        const cuenta = await cuentaModel.obtenerCuentaActiva(req.params.id_mesa);
        res.json({ cuenta }); // null si no hay cuenta abierta
    } catch(e) {
        console.error('getCuentaActiva:', e);
        res.status(500).json({ error: 'Error al obtener la cuenta' });
    }
};

// POST /api/cuentas/:id_cuenta/producto
const agregarProducto = async (req, res) => {
    try {
        const id_cuenta = Number(req.params.id_cuenta);
        const { id_producto, cantidad, precio_unitario, nota } = req.body;

        const resultado = await cuentaModel.agregarProductoCuenta(
            id_cuenta, id_producto, cantidad, precio_unitario, nota, 'cajero', req.usuario.id_usuario
        );

        const cuentaActualizada = await cuentaModel.obtenerCuentaActiva(resultado.id_mesa);

        io()?.to('cajeros').emit('cuenta:producto_agregado', {
            id_cuenta,
            id_mesa:          cuentaActualizada?.id_mesa,
            total_acumulado:  cuentaActualizada?.total_acumulado,
            num_items:        cuentaActualizada?.items?.length
        });
        emitirMesa(resultado.id_mesa, 'cuenta:actualizada', {});

        // Broadcast global: POS y Mesas deben repintar stock al instante
        io()?.emit('actualizacion_stock_global', {
            id_producto:               resultado.id_producto,
            id_sucursal:               resultado.id_sucursal,
            nueva_cantidad_disponible: resultado.nuevo_stock
        });

        res.status(201).json({ detalle: resultado.detalle, total: cuentaActualizada?.total_acumulado, stock: resultado.nuevo_stock });
    } catch(e) {
        console.error('agregarProducto:', e.message);
        if (e.message === 'STOCK_INSUFICIENTE')
            return res.status(409).json({ error: 'Stock insuficiente para este producto' });
        if (e.message === 'PRODUCTO_SIN_INVENTARIO')
            return res.status(404).json({ error: 'El producto no está en el inventario de la sucursal' });
        if (e.message === 'CUENTA_NO_ACTIVA')
            return res.status(404).json({ error: 'La cuenta no está abierta' });
        if (e.message === 'CANTIDAD_INVALIDA')
            return res.status(400).json({ error: 'La cantidad debe ser un entero mayor a 0' });
        res.status(500).json({ error: 'Error al agregar producto' });
    }
};

// DELETE /api/cuentas/detalle/:id_detalle
const quitarProducto = async (req, res) => {
    try {
        const resultado = await cuentaModel.quitarProductoCuenta(req.params.id_detalle, req.usuario.id_usuario);
        const cuentaActualizada = await cuentaModel.obtenerCuentaActiva(resultado.id_mesa);

        io()?.to('cajeros').emit('cuenta:producto_agregado', {
            id_cuenta:       resultado.id_cuenta,
            id_mesa:         cuentaActualizada?.id_mesa,
            total_acumulado: cuentaActualizada?.total_acumulado
        });
        emitirMesa(resultado.id_mesa, 'cuenta:actualizada', {});

        if (resultado.nuevo_stock != null) {
            io()?.emit('actualizacion_stock_global', {
                id_producto:               resultado.id_producto,
                id_sucursal:               resultado.id_sucursal,
                nueva_cantidad_disponible: resultado.nuevo_stock
            });
        }

        res.json({ mensaje: 'Producto eliminado', total: cuentaActualizada?.total_acumulado, stock: resultado.nuevo_stock });
    } catch(e) {
        if (e.message === 'DETALLE_NO_ENCONTRADO')
            return res.status(404).json({ error: 'El producto ya no está en la cuenta' });
        if (e.message === 'DETALLE_PAGADO')
            return res.status(409).json({ error: 'Ese producto ya fue pagado: no se puede quitar' });
        console.error('quitarProducto:', e);
        res.status(500).json({ error: 'Error al quitar producto' });
    }
};

// PATCH /api/cuentas/detalle/:id_detalle { cantidad }
const cambiarCantidad = async (req, res) => {
    try {
        const r = await cuentaModel.cambiarCantidadDetalle(Number(req.params.id_detalle), req.body?.cantidad, req.usuario.id_usuario);
        const cuentaActualizada = await cuentaModel.obtenerCuentaActiva(r.id_mesa);

        io()?.to('cajeros').emit('cuenta:producto_agregado', {
            id_cuenta:       r.id_cuenta,
            id_mesa:         cuentaActualizada?.id_mesa,
            total_acumulado: cuentaActualizada?.total_acumulado
        });
        emitirMesa(r.id_mesa, 'cuenta:actualizada', {});
        if (r.nuevo_stock != null) {
            io()?.emit('actualizacion_stock_global', {
                id_producto:               r.id_producto,
                id_sucursal:               r.id_sucursal,
                nueva_cantidad_disponible: r.nuevo_stock
            });
        }
        res.json({ total: cuentaActualizada?.total_acumulado, stock: r.nuevo_stock });
    } catch (e) {
        if (e.message === 'CANTIDAD_INVALIDA')
            return res.status(400).json({ error: 'La cantidad debe ser un entero mayor a 0' });
        if (e.message === 'STOCK_INSUFICIENTE')
            return res.status(409).json({ error: `Solo hay ${e.disponible} disponibles`, disponible: e.disponible });
        if (e.message === 'DETALLE_NO_ENCONTRADO')
            return res.status(404).json({ error: 'El producto ya no está en la cuenta' });
        if (e.message === 'DETALLE_PAGADO')
            return res.status(409).json({ error: 'Ese producto ya fue pagado: no se puede cambiar' });
        if (e.message === 'PRODUCTO_SIN_INVENTARIO')
            return res.status(404).json({ error: 'El producto no está en el inventario de la sucursal' });
        console.error('cambiarCantidad:', e);
        res.status(500).json({ error: 'Error al cambiar la cantidad' });
    }
};

const CLIENTE_MESA = /^[0-9a-f]{32}$/;

/** null = toda la cuenta; { cliente_mesa } = solo esa parte (null = lo del cajero); false = inválido */
const leerParte = (datos = {}) => {
    if (!('cliente_mesa' in datos)) return null;
    const cliente_mesa = datos.cliente_mesa === '' ? null : datos.cliente_mesa ?? null;
    if (cliente_mesa !== null && !CLIENTE_MESA.test(String(cliente_mesa))) return false;
    return { cliente_mesa };
};

// POST /api/cuentas/:id_cuenta/cerrar  { metodo_pago, cliente_mesa?, descuento? }
// Con cliente_mesa (código del celular, o null = lo cargado por el cajero) se cobra solo esa parte.
const cerrarCuenta = async (req, res) => {
    try {
        const id_cuenta = Number(req.params.id_cuenta);
        const { metodo_pago } = req.body;
        const motivo = await ajusteModel.motivoMetodoPago(metodo_pago);
        if (motivo) return res.status(400).json({ error: motivo });

        const parte = leerParte(req.body);
        if (parte === false) return res.status(400).json({ error: 'Cliente inválido' });

        const resultado = await cuentaModel.cerrarCuenta(id_cuenta, metodo_pago, req.usuario.id_usuario, parte,
                                                         { descuento: req.body?.descuento || null });
        const { id_mesa } = resultado;

        if (resultado.cuenta_cerrada) {
            io()?.to('cajeros').emit('cuenta:cerrada', { id_mesa });
            emitirMesa(id_mesa, 'cuenta:cerrada', {});
        } else {
            io()?.to('cajeros').emit('cuenta:producto_agregado', { id_cuenta, id_mesa });
            emitirMesa(id_mesa, 'cuenta:actualizada', {});
        }
        io()?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        if (resultado.pedidos_pagados.length)
            io()?.to('cajeros').emit('pedido:actualizado', { id_mesa, estado: 'Pagado' });

        res.json({ mensaje: resultado.cuenta_cerrada ? 'Cuenta cerrada y mesa liberada' : 'Cobro registrado', ...resultado });
    } catch(e) {
        if (e.message === 'CUENTA_NO_ACTIVA')
            return res.status(404).json({ error: 'No hay cuenta activa en esta mesa' });
        if (e.message === 'NADA_POR_COBRAR')
            return res.status(409).json({ error: 'No hay nada pendiente de cobro para ese cliente' });
        if (e.message === 'CAJA_CERRADA')
            return res.status(403).json({ error: Number(req.usuario.id_rol) === 1
                ? 'No tienes una caja abierta. Ábrela en «Punto de venta» para cobrar.'
                : 'Tu caja está cerrada. Pide al administrador que la reabra.' });
        if (e.code === 'DESCUENTO_INVALIDO')
            return res.status(400).json({ error: e.message });
        console.error('cerrarCuenta:', e);
        res.status(500).json({ error: 'Error al cerrar la cuenta' });
    }
};

// GET  /api/cuentas/:id_cuenta/cotizacion?cliente_mesa=
// POST /api/cuentas/:id_cuenta/cotizar { cliente_mesa?, descuento? }
// Lo pendiente con promociones y descuento manual (no registra nada)
const cotizarCuenta = async (req, res) => {
    try {
        const datos = req.method === 'POST' ? (req.body || {}) : req.query;
        const parte = leerParte(datos);
        if (parte === false) return res.status(400).json({ error: 'Cliente inválido' });
        const r = await cuentaModel.cotizarCuenta(Number(req.params.id_cuenta), parte, { descuento: datos.descuento || null });
        if (!r) return res.status(404).json({ error: 'No hay cuenta activa en esta mesa' });
        res.json(r);
    } catch (e) {
        if (e.code === 'DESCUENTO_INVALIDO') return res.status(400).json({ error: e.code, detalle: e.message });
        console.error('cotizarCuenta:', e);
        res.status(500).json({ error: 'No se pudo calcular el total.' });
    }
};

// GET /api/cuentas/mesas/:id_sucursal
const getMesasConCuenta = async (req, res) => {
    try {
        const mesas = await cuentaModel.obtenerMesasConCuenta(req.params.id_sucursal);
        res.json(mesas);
    } catch(e) {
        console.error('getMesasConCuenta:', e);
        res.status(500).json({ error: 'Error al obtener mesas' });
    }
};

module.exports = { abrirCuenta, getCuentaActiva, agregarProducto, quitarProducto, cambiarCantidad, cerrarCuenta, getMesasConCuenta, cotizarCuenta };