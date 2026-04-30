const express        = require('express');
const router         = express.Router();
const permisoController = require('../controllers/permisoController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/mis-permisos',          verificarToken, permisoController.obtenerMisPermisos);
router.get('/usuario/:id_usuario',   verificarToken, permisoController.obtenerPermisos);
router.put('/usuario/:id_usuario',   verificarToken, permisoController.guardarPermisos);

module.exports = router;