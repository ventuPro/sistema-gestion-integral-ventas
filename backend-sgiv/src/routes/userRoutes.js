const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Ruta para registrar: POST http://localhost:3000/api/usuarios/registro
router.post('/registro', userController.registrarUsuario);

// Ruta para login: POST http://localhost:3000/api/usuarios/login
router.post('/login', userController.loginUsuario);

module.exports = router;