const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
// 1. Importamos a tu guardia de seguridad
const { verificarToken } = require('../middlewares/authMiddleware');

// 2. Rutas de Caja y Ventas (ahora protegidas por verificarToken)
router.post('/turnos/abrir', verificarToken, cajaController.abrirCaja);
router.post('/cobrar', verificarToken, cajaController.cobrarVenta);

module.exports = router;