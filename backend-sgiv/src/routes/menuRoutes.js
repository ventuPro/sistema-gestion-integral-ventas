const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/menuController');

// Preflight CORS para peticiones del celular


router.get  ('/mesa/:id_mesa',     ctrl.obtenerInfoMesa);
router.get  ('/catalogo',          ctrl.obtenerCatalogoPublico);
router.post ('/pedido',            ctrl.crearPedidoDesdeMenu);
router.get  ('/pedido/:id_pedido', ctrl.estadoPedido);

module.exports = router;