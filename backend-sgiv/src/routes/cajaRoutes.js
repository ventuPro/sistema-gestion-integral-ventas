const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');

// Rutas de Caja y Ventas
router.post('/turnos/abrir', cajaController.abrirCaja);
router.post('/cobrar', cajaController.cobrarVenta);

module.exports = router;