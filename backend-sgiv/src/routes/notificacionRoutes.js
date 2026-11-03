const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificacionController');
const { verificarToken } = require('../middlewares/authMiddleware');

// ─── Notificaciones: cada usuario ve las suyas (el administrador, todas) ───
router.use(verificarToken);

router.get ('/',        ctrl.listar);
router.post('/leidas',  ctrl.marcarLeidas);

module.exports = router;
