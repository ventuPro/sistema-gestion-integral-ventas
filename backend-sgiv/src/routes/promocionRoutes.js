const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/promocionController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

const promociones = [verificarToken, verificarPermiso('promociones')];

router.get   ('/',           promociones, ctrl.listar);
router.post  ('/',           promociones, ctrl.crear);
router.put   ('/:id',        promociones, ctrl.actualizar);
router.patch ('/:id/estado', promociones, ctrl.cambiarEstado);
router.delete('/:id',        promociones, ctrl.eliminar);

module.exports = router;
