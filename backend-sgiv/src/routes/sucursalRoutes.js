const express = require('express');
const router = express.Router();
const sucursalController = require('../controllers/sucursalController');
const { verificarToken, soloAdministrador } = require('../middlewares/authMiddleware');

const admin = [verificarToken, soloAdministrador];

router.get('/',             verificarToken, sucursalController.listarSucursales);
router.post('/',            admin, sucursalController.crearSucursal);
router.put('/:id',          admin, sucursalController.actualizarSucursal);
router.patch('/:id/estado', admin, sucursalController.cambiarEstado);

module.exports = router;
