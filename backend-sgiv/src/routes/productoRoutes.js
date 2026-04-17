const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');

// Rutas para Categorías
router.post('/categorias', productoController.agregarCategoria); // POST http://localhost:3000/api/catalogo/categorias
router.get('/categorias', productoController.listarCategorias);  // GET http://localhost:3000/api/catalogo/categorias

// Rutas para Productos
router.post('/productos', productoController.agregarProducto);   // POST http://localhost:3000/api/catalogo/productos
router.get('/productos', productoController.listarProductos);    // GET http://localhost:3000/api/catalogo/productos

module.exports = router;