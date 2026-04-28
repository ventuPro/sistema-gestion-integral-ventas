const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verificarToken } = require('../middlewares/authMiddleware');

// --- Rutas Públicas (sin token) ---
router.post('/registro', userController.registrarUsuario);
router.post('/login', userController.loginUsuario);

// --- Rutas Protegidas (requieren token JWT) ---
router.get('/',               verificarToken, userController.listarUsuarios);
router.get('/formulario',     verificarToken, userController.obtenerFormularioDatos);
router.put('/:id',            verificarToken, userController.editarUsuario);
router.delete('/:id',         verificarToken, userController.eliminarUsuario);

module.exports = router;