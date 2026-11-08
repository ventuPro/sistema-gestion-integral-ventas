const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

router.get('/dashboard-completo/:id_sucursal', verificarToken, verificarPermiso('dashboard'), reporteController.obtenerPanel);
router.get('/periodo/:id_sucursal',            verificarToken, verificarPermiso('reportes'),  reporteController.obtenerInforme);
router.get('/inventario-valorado/:id_sucursal', verificarToken, verificarPermiso('reportes'), reporteController.inventarioValorado);
router.get('/kardex/:id_sucursal',             verificarToken, verificarPermiso('reportes'),  reporteController.kardex);

module.exports = router;
