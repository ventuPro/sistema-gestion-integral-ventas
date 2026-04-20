const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');
// 1. Importamos tu candado de seguridad
const { verificarToken } = require('../middlewares/authMiddleware'); 

// Rutas para Categorías (Protegidas)
router.post('/categorias', verificarToken, productoController.agregarCategoria); 
router.get('/categorias', verificarToken, productoController.listarCategorias);  

// Rutas para Productos (Protegidas)
router.post('/productos', verificarToken, productoController.agregarProducto);   
router.get('/productos', verificarToken, productoController.listarProductos);    

module.exports = router;