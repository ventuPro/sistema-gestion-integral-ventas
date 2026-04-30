const express = require('express');
const router  = express.Router();
const menuController = require('../controllers/menuController');

// Sin autenticación — acceso desde el celular del cliente
router.get('/mesa/:id_mesa',          menuController.obtenerInfoMesa);
router.get('/catalogo',               menuController.obtenerCatalogoPublico);
router.post('/pedido',                menuController.crearPedidoDesdeMenu);
router.get('/pedido/:id_pedido',      menuController.estadoPedido);

module.exports = router;