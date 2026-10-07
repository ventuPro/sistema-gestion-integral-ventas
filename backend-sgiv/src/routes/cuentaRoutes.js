const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cuentaController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');
const pedidoModel = require('../models/pedidoModel');
const { emitirStock, emitirMesa } = require('../utils/tiempoReal');

const mesas = [verificarToken, verificarPermiso('mesas')];

router.get  ('/mesas/:id_sucursal',       mesas, ctrl.getMesasConCuenta);
router.get  ('/mesa/:id_mesa',            mesas, ctrl.getCuentaActiva);
router.post ('/abrir',                    mesas, ctrl.abrirCuenta);
router.post ('/:id_cuenta/producto',      mesas, ctrl.agregarProducto);
router.delete('/detalle/:id_detalle',     mesas, ctrl.quitarProducto);
router.post ('/:id_cuenta/cerrar',        mesas, ctrl.cerrarCuenta);
router.post('/:id_cuenta/cancelar-si-vacia', mesas, async (req, res) => {
    try {
        const id_cuenta = Number(req.params.id_cuenta);
        const db = require('../config/db');

        const c = await db.query(
            `SELECT id_cuenta, id_mesa, estado FROM cuenta_mesa WHERE id_cuenta=$1`,
            [id_cuenta]
        );
        if (c.rows.length === 0)
            return res.status(404).json({ error: 'Cuenta no encontrada' });
        if (c.rows[0].estado !== 'Abierta')
            return res.status(400).json({ error: 'La cuenta no está abierta' });

        const items = await db.query(
            `SELECT COUNT(*)::int AS n FROM detalle_cuenta WHERE id_cuenta=$1`,
            [id_cuenta]
        );
        if (items.rows[0].n > 0)
            return res.status(400).json({ error: 'CUENTA_NO_VACIA' });

        const id_mesa = c.rows[0].id_mesa;
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            // Si el cajero quitó todos los productos de pedidos QR, esos pedidos quedan cancelados
            await pedidoModel.finalizarPedidosDeCuenta(client, id_cuenta, 'Cancelado');
            await client.query(
                `UPDATE cuenta_mesa SET estado='Cancelada', fecha_cierre=NOW() WHERE id_cuenta=$1`,
                [id_cuenta]
            );
            await client.query(
                `UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`,
                [id_mesa]
            );
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        global.io?.to('cajeros').emit('cuenta:cerrada', { id_mesa });
        emitirMesa(id_mesa, 'cuenta:cerrada', {});
        res.json({ mensaje: 'Cuenta vacía cancelada — mesa liberada', id_mesa });
    } catch(e) {
        console.error('cancelar-si-vacia:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/reset-mesa', mesas, async (req, res) => {
    if (Number(req.usuario.id_rol) !== 1)
        return res.status(403).json({ error: 'Solo el administrador puede resetear una mesa' });
    const db = require('../config/db');
    const cuentaModel = require('../models/cuentaModel');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const { id_mesa } = req.body;

        const rC = await client.query(`
            SELECT id_cuenta FROM cuenta_mesa
            WHERE id_mesa=$1 AND estado='Abierta'
        `, [id_mesa]);

        let cambiosStock = [];
        for (const row of rC.rows) {
            cambiosStock = cambiosStock.concat(
                await cuentaModel.devolverStockCuenta(client, row.id_cuenta)
            );
            await pedidoModel.finalizarPedidosDeCuenta(client, row.id_cuenta, 'Cancelado');
            await client.query(`
                UPDATE cuenta_mesa SET estado='Cancelada', fecha_cierre=NOW()
                WHERE id_cuenta=$1
            `, [row.id_cuenta]);
        }

        // Pedidos QR sin confirmar de la mesa: se cancelan y su stock vuelve
        const pendientes = await pedidoModel.cancelarPendientesMesa(client, id_mesa);
        cambiosStock = cambiosStock.concat(pendientes.cambios);

        await client.query(
            `UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`, [id_mesa]
        );
        await client.query('COMMIT');

        global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        global.io?.to('cajeros').emit('pedido:actualizado', { id_mesa, estado: 'Cancelado' });
        emitirMesa(id_mesa, 'cuenta:cerrada', {});
        emitirStock(cambiosStock);

        res.json({ mensaje: 'Mesa reseteada correctamente' });
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

module.exports = router;