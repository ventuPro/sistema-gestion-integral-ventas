const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/userController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

// Gestión de usuarios: requiere sesión + permiso del módulo 'usuarios'
const gestion = [verificarToken, verificarPermiso('usuarios')];

router.post  ('/registro',          gestion, ctrl.registrarUsuario);
router.get   ('/captcha',           ctrl.obtenerCaptcha);
router.post  ('/login',             ctrl.loginUsuario);
router.post  ('/login/mfa',         ctrl.verificarMfa);
router.get   ('/',                  gestion, ctrl.listarUsuarios);
router.get   ('/form-data',         gestion, ctrl.obtenerDatosFormulario);
router.put   ('/:id',               gestion, ctrl.actualizarUsuario);
router.patch ('/:id/desactivar',    gestion, ctrl.desactivarUsuario);
router.patch ('/:id/reactivar',     gestion, ctrl.reactivarUsuario);
router.patch ('/:id/contrasena',    gestion, ctrl.cambiarContrasena);
router.patch ('/:id/mfa/restablecer', gestion, ctrl.restablecerMfa);

module.exports = router;