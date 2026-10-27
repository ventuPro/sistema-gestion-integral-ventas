const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventarioController');
const { verificarToken, verificarPermiso, soloAdministrador } = require('../middlewares/authMiddleware');

const inventario = [verificarToken, verificarPermiso('inventario')];

router.get ('/motivos',     inventario, ctrl.listarMotivos);
router.get ('/movimientos', inventario, ctrl.listarMovimientos);
router.post('/movimientos', inventario, ctrl.registrarMovimiento);
router.get ('/transferencias',     inventario, ctrl.listarTransferencias);
router.get ('/transferencias/:id', inventario, ctrl.obtenerTransferencia);
router.post('/transferencias',     inventario, ctrl.crearTransferencia);
router.get ('/lista-dia',          inventario, ctrl.obtenerListaDia);
router.post('/lista-dia/:id/desbloquear', verificarToken, soloAdministrador, ctrl.desbloquearListaDia);

module.exports = router;
