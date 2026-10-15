const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/asistenteController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Asistente del personal: cada función de datos revisa los permisos del usuario
router.post('/', verificarToken, ctrl.interno);

module.exports = router;
