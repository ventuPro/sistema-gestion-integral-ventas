const inventarioModel = require('../models/inventarioModel');
const transferenciaModel = require('../models/transferenciaModel');
const listaDiaModel = require('../models/listaDiaModel');
const { emitirStock, emitirCajeros } = require('../utils/tiempoReal');

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

// ─── Transferencias entre sucursales ───
const ERRORES_TRANSFERENCIA = { INVALIDA: 400, NO_EXISTE: 404, SIN_STOCK: 409 };

// POST /api/inventario/transferencias { id_sucursal_origen?, id_sucursal_destino, items, observacion }
const crearTransferencia = async (req, res) => {
    try {
        const id_origen = sucursalPermitida(req, req.body?.id_sucursal_origen);
        if (!id_origen) return res.status(403).json({ error: 'Solo puedes transferir desde tu sucursal' });
        const r = await transferenciaModel.crear({
            id_origen, id_destino: Number(req.body?.id_sucursal_destino), id_usuario: req.usuario.id_usuario,
            items: req.body?.items, observacion: req.body?.observacion
        });
        const t = r.transferencia;
        emitirStock(r.cambios);
        emitirCajeros('transferencia:nueva', {
            id_transferencia: t.id_transferencia, id_usuario: req.usuario.id_usuario,
            id_sucursal_origen: t.id_sucursal_origen, nombre_origen: t.nombre_origen,
            id_sucursal_destino: t.id_sucursal_destino, nombre_destino: t.nombre_destino,
            resumen: r.items.map(i => `${i.cantidad} ${i.nombre_producto}`).join(', ')
        });
        res.status(201).json({ mensaje: `Transferencia #${t.id_transferencia} a ${t.nombre_destino} registrada`,
                               id_transferencia: t.id_transferencia });
    } catch (e) {
        const status = ERRORES_TRANSFERENCIA[e.codigo];
        if (status) return res.status(status).json({ error: e.message, codigo: e.codigo });
        console.error('crearTransferencia:', e);
        res.status(500).json({ error: 'No se pudo registrar la transferencia' });
    }
};

// GET /api/inventario/transferencias?id_sucursal&desde&hasta  (admin sin sucursal = todas)
const listarTransferencias = async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta)))
            return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD' });
        const id_sucursal = esAdmin(req) ? (Number(req.query.id_sucursal) || null) : Number(req.usuario.id_sucursal);
        const limite = Math.min(Math.max(Number(req.query.limite) || 200, 1), 500);
        res.json(await transferenciaModel.listar({ id_sucursal, desde: desde || null, hasta: hasta || null, limite }));
    } catch (e) {
        console.error('listarTransferencias:', e);
        res.status(500).json({ error: 'No se pudieron consultar las transferencias' });
    }
};

// GET /api/inventario/transferencias/:id
const obtenerTransferencia = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Transferencia no encontrada' });
        const t = await transferenciaModel.obtener(id, esAdmin(req) ? null : Number(req.usuario.id_sucursal));
        if (!t) return res.status(404).json({ error: 'Transferencia no encontrada' });
        res.json(t);
    } catch (e) {
        console.error('obtenerTransferencia:', e);
        res.status(500).json({ error: 'No se pudo consultar la transferencia' });
    }
};

// ─── Lista de productos que quedaron del día anterior ───

// GET /api/inventario/lista-dia?id_sucursal  (el cajero, la de su sucursal)
const obtenerListaDia = async (req, res) => {
    try {
        const id_sucursal = sucursalPermitida(req, req.query.id_sucursal);
        if (!id_sucursal) return res.status(403).json({ error: 'Solo puedes ver la lista de tu sucursal' });
        const lista = await listaDiaModel.obtener(id_sucursal, esAdmin(req));
        if (!lista) return res.status(404).json({ error: 'Todavía no hay una lista guardada para esta sucursal' });
        res.json(lista);
    } catch (e) {
        console.error('obtenerListaDia:', e);
        res.status(500).json({ error: 'No se pudo consultar la lista' });
    }
};

// POST /api/inventario/lista-dia/:id/desbloquear  (solo administrador)
const desbloquearListaDia = async (req, res) => {
    try {
        const foto = await listaDiaModel.desbloquear(Number(req.params.id) || 0, req.usuario.id_usuario);
        if (!foto) return res.status(404).json({ error: 'Lista no encontrada' });
        emitirCajeros('lista_dia:actualizada', { id_sucursal: foto.id_sucursal });
        res.json({ mensaje: 'El cajero ya puede imprimir la lista' });
    } catch (e) {
        console.error('desbloquearListaDia:', e);
        res.status(500).json({ error: 'No se pudo dar acceso a la lista' });
    }
};

module.exports = { listarMotivos, registrarMovimiento, listarMovimientos,
                   obtenerListaDia, desbloquearListaDia,
                   crearTransferencia, listarTransferencias, obtenerTransferencia };
