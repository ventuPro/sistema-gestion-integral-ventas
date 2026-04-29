const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Rutas públicas
router.post('/registro', userController.registrarUsuario);
router.post('/login', userController.loginUsuario);

// Rutas protegidas
router.get('/',                    verificarToken, userController.listarUsuarios);
router.get('/formulario',          verificarToken, userController.obtenerFormularioDatos);
router.put('/:id',                 verificarToken, userController.editarUsuario);
router.delete('/:id',              verificarToken, userController.eliminarUsuario);
router.patch('/:id/reactivar',     verificarToken, userController.reactivarUsuario);
router.patch('/:id/contrasena',    verificarToken, userController.cambiarContrasena);

module.exports = router;