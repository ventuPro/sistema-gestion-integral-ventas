const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');
// Importamos a nuestro nuevo guardia de seguridad
const { verificarToken } = require('../middlewares/authMiddleware'); 

// Rutas protegidas (solo entran los que tienen Token)
router.post('/categorias', verificarToken, productoController.agregarCategoria);
router.get('/categorias', verificarToken, productoController.listarCategorias);
router.delete('/categorias/:id', verificarToken, productoController.eliminarCategoria);

router.post('/productos', verificarToken, productoController.agregarProducto);   
router.get('/productos', verificarToken, productoController.listarProductos);    
// Usamos router.delete y le pasamos un parámetro /:id
router.delete('/productos/:id', verificarToken, productoController.eliminarProducto);
module.exports = router;

// Ruta PUT para editar un producto específico
router.put('/productos/:id', verificarToken, productoController.actualizarProducto);

// Ruta PATCH para sumar stock a un producto específico
router.patch('/productos/:id/stock', verificarToken, productoController.sumarStock);