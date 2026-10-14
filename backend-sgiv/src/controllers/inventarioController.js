const inventarioModel = require('../models/inventarioModel');
const { emitirStock } = require('../utils/tiempoReal');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esAdmin = (req) => Number(req.usuario.id_rol) === 1;

/** El administrador elige la sucursal; el resto trabaja solo con la suya (null = pidió otra). */
const sucursalPermitida = (req, pedida) => {
    const propia = Number(req.usuario.id_sucursal);
    if (esAdmin(req)) return Number(pedida) || propia;
    return !pedida || Number(pedida) === propia ? propia : null;
};

// GET /api/inventario/motivos
const listarMotivos = (req, res) => res.json(inventarioModel.MOTIVOS);

// POST /api/inventario/movimientos — entrada o merma manual
const registrarMovimiento = async (req, res) => {
    try {
        const { id_producto, tipo, motivo } = req.body || {};
        const cantidad = Number(req.body?.cantidad);
        const detalle  = String(req.body?.detalle ?? '').trim() || null;

        const id_sucursal = sucursalPermitida(req, req.body?.id_sucursal);
        if (!id_sucursal) return res.status(403).json({ error: 'Solo puedes mover el inventario de tu sucursal' });
        if (!Number(id_producto)) return res.status(400).json({ error: 'Producto inválido' });
        if (!inventarioModel.MOTIVOS[tipo]) return res.status(400).json({ error: 'El tipo debe ser INGRESO o SALIDA' });
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000)
            return res.status(400).json({ error: 'La cantidad debe ser un número entero entre 1 y 100000' });
        if (!inventarioModel.MOTIVOS[tipo].includes(motivo)) return res.status(400).json({ error: 'Motivo inválido' });
        if (motivo === 'Otro' && !detalle) return res.status(400).json({ error: 'Describe el motivo en la observación' });
        if (detalle && detalle.length > 200) return res.status(400).json({ error: 'La observación admite hasta 200 caracteres' });

        const r = await inventarioModel.registrarMovimiento({
            id_sucursal, id_producto: Number(id_producto), id_usuario: req.usuario.id_usuario,
            tipo, cantidad, motivo, detalle
        });
        emitirStock([{ id_producto: Number(id_producto), id_sucursal, nuevo_stock: r.cantidad_actual }]);
        res.status(201).json({ mensaje: 'Movimiento registrado', stock_actual: r.cantidad_actual });
    } catch (error) {
        if (error.codigo === 'SIN_STOCK') return res.status(409).json({ error: error.message, codigo: error.codigo });
        if (error.codigo === 'NO_EXISTE') return res.status(404).json({ error: error.message });
        console.error('registrarMovimiento:', error);
        res.status(500).json({ error: 'No se pudo registrar el movimiento' });
    }
};

// GET /api/inventario/movimientos?id_sucursal&id_producto&tipo&desde&hasta&limite
const listarMovimientos = async (req, res) => {
    try {
        const { id_producto, tipo, desde, hasta } = req.query;
        const id_sucursal = sucursalPermitida(req, req.query.id_sucursal);
        if (!id_sucursal) return res.status(403).json({ error: 'Solo puedes ver el inventario de tu sucursal' });
        if (tipo && !inventarioModel.MOTIVOS[tipo]) return res.status(400).json({ error: 'Tipo inválido' });
        if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta)))
            return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD' });

        const limite = Math.min(Math.max(Number(req.query.limite) || 200, 1), 500);
        res.json(await inventarioModel.listarMovimientos({
            id_sucursal, id_producto: Number(id_producto) || null, tipo: tipo || null,
            desde: desde || null, hasta: hasta || null, limite
        }));
    } catch (error) {
        console.error('listarMovimientos:', error);
        res.status(500).json({ error: 'No se pudo consultar el historial' });
    }
};

module.exports = { listarMotivos, registrarMovimiento, listarMovimientos };
