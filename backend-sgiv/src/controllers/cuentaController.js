const cuentaModel  = require('../models/cuentaModel');
const productoModel = require('../models/productoModel');
const mesaModel    = require('../models/mesaModel');
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

        const detalle = await cuentaModel.agregarProductoCuenta(
            id_cuenta, id_producto, cantidad, precio_unitario, nota, 'cajero'
        );

        // Obtener cuenta actualizada para emitir por socket
        const cuentaActualizada = await cuentaModel.obtenerCuentaActiva(
            await cuentaModel.getCuentaMesaId(id_cuenta)
        );

        io()?.to('cajeros').emit('cuenta:producto_agregado', {
            id_cuenta,
            id_mesa:          cuentaActualizada?.id_mesa,
            total_acumulado:  cuentaActualizada?.total_acumulado,
            num_items:        cuentaActualizada?.items?.length
        });

        res.status(201).json({ detalle, total: cuentaActualizada?.total_acumulado });
    } catch(e) {
        console.error('agregarProducto:', e);
        res.status(500).json({ error: 'Error al agregar producto' });
    }
};

// DELETE /api/cuentas/detalle/:id_detalle
const quitarProducto = async (req, res) => {
    try {
        const { id_cuenta } = await cuentaModel.quitarProductoCuenta(req.params.id_detalle);
        const cuentaActualizada = await cuentaModel.obtenerCuentaActiva(
            await cuentaModel.getCuentaMesaId(id_cuenta)
        );

        io()?.to('cajeros').emit('cuenta:producto_agregado', {
            id_cuenta,
            id_mesa:         cuentaActualizada?.id_mesa,
            total_acumulado: cuentaActualizada?.total_acumulado
        });

        res.json({ mensaje: 'Producto eliminado', total: cuentaActualizada?.total_acumulado });
    } catch(e) {
        console.error('quitarProducto:', e);
        res.status(500).json({ error: 'Error al quitar producto' });
    }
};

// POST /api/cuentas/:id_cuenta/cerrar
const cerrarCuenta = async (req, res) => {
    try {
        const id_cuenta       = Number(req.params.id_cuenta);
        const { metodo_pago, id_sucursal } = req.body;
        const id_usuario_cajero = req.usuario.id_usuario;

        const resultado = await cuentaModel.cerrarCuenta(
            id_cuenta, metodo_pago, id_usuario_cajero, id_sucursal
        );

        io()?.to('cajeros').emit('cuenta:cerrada', { id_mesa: resultado.id_mesa });
        io()?.to('cajeros').emit('mesa:actualizada', { id_mesa: resultado.id_mesa });

        res.json({ mensaje: 'Cuenta cerrada y mesa liberada', ...resultado });
    } catch(e) {
        if (e.message === 'CUENTA_NO_ACTIVA')
            return res.status(404).json({ error: 'No hay cuenta activa en esta mesa' });
        console.error('cerrarCuenta:', e);
        res.status(500).json({ error: 'Error al cerrar la cuenta' });
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

module.exports = { abrirCuenta, getCuentaActiva, agregarProducto, quitarProducto, cerrarCuenta, getMesasConCuenta };