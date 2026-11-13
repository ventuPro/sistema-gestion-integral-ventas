const express = require('express');
const router = express.Router();
const productoController = require('../controllers/productoController');
// Importamos a nuestro nuevo guardia de seguridad
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

// Lectura: cualquier usuario con sesión (POS, Mesas). Escritura: módulo 'inventario'.
const editar = [verificarToken, verificarPermiso('inventario')];

// Rutas protegidas (solo entran los que tienen Token)
router.post('/categorias', editar, productoController.agregarCategoria);
router.get('/categorias', verificarToken, productoController.listarCategorias);
router.put('/categorias/orden', editar, productoController.ordenarCategorias);
router.delete('/categorias/:id', editar, productoController.eliminarCategoria);

router.post('/productos', editar, productoController.agregarProducto);   
router.get('/productos', verificarToken, productoController.listarProductos);
router.get ('/productos/faltantes',         editar, productoController.listarFaltantes);
router.get ('/productos/parecidos',         editar, productoController.listarParecidos);
router.get ('/productos/:id/uso',           editar, productoController.usoProducto);
router.post('/productos/agregar-a-sucursal', editar, productoController.agregarASucursal);    
// Usamos router.delete y le pasamos un parámetro /:id
router.delete('/productos/:id',        editar, productoController.eliminarProducto);
router.patch('/productos/:id/reactivar', editar, productoController.reactivarProducto);
router.put('/productos/:id',        editar, productoController.actualizarProducto);

module.exports = router;