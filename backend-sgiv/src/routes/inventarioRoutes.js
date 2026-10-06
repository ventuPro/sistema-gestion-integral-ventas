const express = require('express');
const router = express.Router();
const inventarioController = require('../controllers/inventarioController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

// Ruta para hacer un ingreso o salida de stock
router.post('/movimiento', verificarToken, verificarPermiso('inventario'), inventarioController.agregarMovimiento);

// Ruta para ver el inventario (Nota que usamos :id_sucursal como variable en la URL)
router.get('/:id_sucursal', verificarToken, inventarioController.consultarInventario);

module.exports = router;