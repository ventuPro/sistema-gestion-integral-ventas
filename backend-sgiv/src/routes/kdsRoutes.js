const express = require('express');
const router  = express.Router();
const kdsController = require('../controllers/kdsController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/',                       verificarToken, kdsController.obtenerPedidosKDS);
router.patch('/item/:id_detalle',     verificarToken, kdsController.actualizarItemKDS);

module.exports = router;