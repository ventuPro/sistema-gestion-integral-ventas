const express    = require('express');
const router     = express.Router();
const pedidoController = require('../controllers/pedidoController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

// Bandeja del cajero: pedidos hechos por los clientes desde el menú QR.
// (Las rutas públicas del cliente están en menuRoutes.)
const cajero = [verificarToken, verificarPermiso('mesas')];

router.get   ('/bandeja',                          cajero, pedidoController.obtenerBandeja);
router.patch ('/:id_pedido/detalle/:id_detalle',   cajero, pedidoController.ajustarDetalle);
router.post  ('/:id_pedido/confirmar',             cajero, pedidoController.confirmarPedido);
router.post  ('/:id_pedido/rechazar',              cajero, pedidoController.rechazarPedido);
router.post  ('/:id_pedido/entregado',             cajero, pedidoController.marcarEntregado);

module.exports = router;
