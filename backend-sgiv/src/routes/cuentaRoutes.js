const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cuentaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get  ('/mesas/:id_sucursal',       verificarToken, ctrl.getMesasConCuenta);
router.get  ('/mesa/:id_mesa',            verificarToken, ctrl.getCuentaActiva);
router.post ('/abrir',                    verificarToken, ctrl.abrirCuenta);
router.post ('/:id_cuenta/producto',      verificarToken, ctrl.agregarProducto);
router.delete('/detalle/:id_detalle',     verificarToken, ctrl.quitarProducto);
router.post ('/:id_cuenta/cerrar',        verificarToken, ctrl.cerrarCuenta);
router.post('/:id_cuenta/cancelar-si-vacia', verificarToken, async (req, res) => {
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
        await db.query(
            `UPDATE cuenta_mesa SET estado='Cancelada', fecha_cierre=NOW() WHERE id_cuenta=$1`,
            [id_cuenta]
        );
        await db.query(
            `UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`,
            [id_mesa]
        );

        global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        global.io?.to('cajeros').emit('cuenta:cerrada', { id_mesa });
        res.json({ mensaje: 'Cuenta vacía cancelada — mesa liberada', id_mesa });
    } catch(e) {
        console.error('cancelar-si-vacia:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/reset-mesa', verificarToken, async (req, res) => {
    try {
        const { id_mesa } = req.body;
        const db = require('../config/db');

        await db.query(`
            UPDATE cuenta_mesa SET estado='Cancelada', fecha_cierre=NOW()
            WHERE id_mesa=$1 AND estado='Abierta'
        `, [id_mesa]);

        await db.query(
            `UPDATE mesa_local SET estado_mesa='Libre' WHERE id_mesa=$1`, [id_mesa]
        );

        global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        res.json({ mensaje: 'Mesa reseteada correctamente' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;