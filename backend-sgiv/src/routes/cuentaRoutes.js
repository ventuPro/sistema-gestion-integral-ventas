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