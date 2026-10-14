const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventarioController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

const inventario = [verificarToken, verificarPermiso('inventario')];

router.get ('/motivos',     inventario, ctrl.listarMotivos);
router.get ('/movimientos', inventario, ctrl.listarMovimientos);
router.post('/movimientos', inventario, ctrl.registrarMovimiento);

module.exports = router;
