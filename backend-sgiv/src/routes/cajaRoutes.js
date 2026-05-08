const express = require('express');
const router  = express.Router();
const cajaController = require('../controllers/cajaController');
const { verificarToken } = require('../middlewares/authMiddleware');

// ─── Control de caja (Admin) ───
router.get('/estado/:id_usuario',        verificarToken, cajaController.getEstadoCaja);
router.patch('/habilitar/:id_usuario',   verificarToken, cajaController.habilitarCajaUsuario);
router.patch('/deshabilitar/:id_usuario',verificarToken, cajaController.deshabilitarCajaUsuario);

// ─── Turnos y ventas ───
router.post('/turnos/abrir',  verificarToken, cajaController.abrirCaja);
router.post('/cobrar',        verificarToken, cajaController.cobrarVenta);
router.get('/arqueo/:id_sucursal', verificarToken, cajaController.obtenerArqueo);
router.post('/cierre',        verificarToken, cajaController.cierreDiario);

module.exports = router;