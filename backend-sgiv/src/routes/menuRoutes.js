const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/menuController');

// Menú digital del cliente (público). :codigo = código QR de la mesa
router.get  ('/m/:codigo',                              ctrl.cargarMesa, ctrl.obtenerMesa);
router.get  ('/m/:codigo/catalogo',                     ctrl.cargarMesa, ctrl.obtenerCatalogo);
router.get  ('/m/:codigo/estado',                       ctrl.cargarMesa, ctrl.obtenerEstado);
router.post ('/m/:codigo/pedidos',                      ctrl.cargarMesa, ctrl.crearPedido);
router.post ('/m/:codigo/pedidos/:id_pedido/cancelar',  ctrl.cargarMesa, ctrl.cancelarPedido);

module.exports = router;
