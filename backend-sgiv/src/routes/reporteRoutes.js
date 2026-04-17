const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');

// Ruta principal para cargar todo el Dashboard de una sucursal
router.get('/dashboard/:id_sucursal', reporteController.obtenerDashboard);

module.exports = router;