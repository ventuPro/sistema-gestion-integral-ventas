const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/userController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

// Gestión de usuarios: requiere sesión + permiso del módulo 'usuarios'
const gestion = [verificarToken, verificarPermiso('usuarios')];

router.post  ('/registro',          gestion, ctrl.registrarUsuario);
router.post  ('/login',             ctrl.loginUsuario);
router.get   ('/',                  gestion, ctrl.listarUsuarios);
router.get   ('/form-data',         gestion, ctrl.obtenerDatosFormulario);
router.put   ('/:id',               gestion, ctrl.actualizarUsuario);
router.patch ('/:id/desactivar',    gestion, ctrl.desactivarUsuario);
router.patch ('/:id/reactivar',     gestion, ctrl.reactivarUsuario);
router.patch ('/:id/contrasena',    gestion, ctrl.cambiarContrasena);

module.exports = router;