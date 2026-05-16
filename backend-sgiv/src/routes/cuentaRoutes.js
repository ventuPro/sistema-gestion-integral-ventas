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

module.exports = router;