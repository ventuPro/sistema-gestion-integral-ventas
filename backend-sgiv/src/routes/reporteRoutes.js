const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

router.get('/dashboard-completo/:id_sucursal', verificarToken, verificarPermiso('dashboard'), reporteController.obtenerPanel);
router.get('/periodo/:id_sucursal',            verificarToken, verificarPermiso('reportes'),  reporteController.obtenerInforme);
router.get('/dia-detalle/:id_sucursal',        verificarToken, verificarPermiso('reportes'),  reporteController.obtenerDesgloseDia);

module.exports = router;
