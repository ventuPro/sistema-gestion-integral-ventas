const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ajusteController');
const propietarios = require('../controllers/propietarioController');
const { verificarToken, soloAdministrador } = require('../middlewares/authMiddleware');

const admin = [verificarToken, soloAdministrador];

// Público: nombre, logo y colores para el login y el menú QR
router.get('/publico',    ctrl.obtenerPublico);

router.get('/',           admin, ctrl.obtener);
router.put('/empresa',    admin, ctrl.guardarEmpresa);
router.put('/apariencia', admin, ctrl.guardarApariencia);

// Propietarios: datos privados, solo el administrador
router.get   ('/propietarios',     admin, propietarios.listar);
router.post  ('/propietarios',     admin, propietarios.crear);
router.put   ('/propietarios/:id', admin, propietarios.actualizar);
router.delete('/propietarios/:id', admin, propietarios.eliminar);

module.exports = router;
