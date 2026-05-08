const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/userController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.post  ('/registro',          ctrl.registrarUsuario);
router.post  ('/login',             ctrl.loginUsuario);
router.get   ('/',                  verificarToken, ctrl.listarUsuarios);
router.get   ('/form-data',         verificarToken, ctrl.obtenerDatosFormulario);
router.put   ('/:id',               verificarToken, ctrl.actualizarUsuario);
router.patch ('/:id/desactivar',    verificarToken, ctrl.desactivarUsuario);
router.patch ('/:id/reactivar',     verificarToken, ctrl.reactivarUsuario);
router.patch ('/:id/contrasena',    verificarToken, ctrl.cambiarContrasena);

module.exports = router;