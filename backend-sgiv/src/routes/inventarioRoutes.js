const express = require('express');
const router = express.Router();
const inventarioController = require('../controllers/inventarioController');

// Ruta para hacer un ingreso o salida de stock
router.post('/movimiento', inventarioController.agregarMovimiento);

// Ruta para ver el inventario (Nota que usamos :id_sucursal como variable en la URL)
router.get('/:id_sucursal', inventarioController.consultarInventario);

module.exports = router;