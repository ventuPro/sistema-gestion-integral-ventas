const express    = require('express');
const router     = express.Router();
const pedidoController = require('../controllers/pedidoController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Rutas públicas (cliente con QR)
router.post('/publico/nuevo',              pedidoController.abrirPedido);
router.post('/publico/agregar-producto',   pedidoController.agregarProductoPedido);
router.get('/publico/estado/:id_pedido',   pedidoController.verEstadoPedido);

// Rutas protegidas (cajero/admin)
router.get('/mesas/:id_sucursal',          verificarToken, pedidoController.listarMesas);
router.post('/mesas',                      verificarToken, pedidoController.agregarMesa);
router.get('/pendientes/:id_sucursal',     verificarToken, pedidoController.listarPendientesCajero);
router.patch('/:id_pedido/aprobar',        verificarToken, pedidoController.aprobarPedido);
router.patch('/:id_pedido/rechazar',       verificarToken, pedidoController.rechazarPedido);

module.exports = router;