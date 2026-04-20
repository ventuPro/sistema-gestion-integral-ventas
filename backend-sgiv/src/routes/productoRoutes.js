const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');
// Importamos a nuestro nuevo guardia de seguridad
const { verificarToken } = require('../middlewares/authMiddleware'); 

// Rutas protegidas (solo entran los que tienen Token)
router.post('/categorias', verificarToken, productoController.agregarCategoria); 
router.get('/categorias', verificarToken, productoController.listarCategorias);  

router.post('/productos', verificarToken, productoController.agregarProducto);   
router.get('/productos', verificarToken, productoController.listarProductos);    

module.exports = router;