const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/permisoController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get ('/mis-permisos',    verificarToken, ctrl.getMisPermisos);
router.get ('/usuario/:id',     verificarToken, ctrl.getPermisosUsuario);
router.put ('/usuario/:id',     verificarToken, ctrl.putPermisosUsuario);

module.exports = router;