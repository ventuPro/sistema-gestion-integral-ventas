const express = require('express');
const router = express.Router();
const pedidoController = require('../controllers/pedidoController');

// Rutas de Mesas (Para el Administrador/Empleados)
router.post('/mesas', pedidoController.agregarMesa);
router.get('/mesas/:id_sucursal', pedidoController.listarMesas);

// Rutas de Pedidos (Para el Cliente con el QR)
router.post('/nuevo', pedidoController.abrirPedido);
router.post('/agregar-producto', pedidoController.agregarProductoPedido);

module.exports = router;