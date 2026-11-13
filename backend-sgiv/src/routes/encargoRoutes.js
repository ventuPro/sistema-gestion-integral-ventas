const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/encargoController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

const encargos = [verificarToken, verificarPermiso('encargos')];

router.get   ('/',           encargos, ctrl.listar);
router.get   ('/hoy',        encargos, ctrl.pendientesHoy);
router.get   ('/:id',        encargos, ctrl.obtener);
router.post  ('/',           encargos, ctrl.crear);
router.put   ('/:id',        encargos, ctrl.actualizar);
router.patch ('/:id/estado', encargos, ctrl.cambiarEstado);
router.delete('/:id',        encargos, ctrl.eliminar);

module.exports = router;
