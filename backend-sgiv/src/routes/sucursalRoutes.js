const express = require('express');
const router = express.Router();
const sucursalController = require('../controllers/sucursalController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/',  verificarToken, sucursalController.listarSucursales);
router.post('/', verificarToken, sucursalController.crearSucursal);

module.exports = router;