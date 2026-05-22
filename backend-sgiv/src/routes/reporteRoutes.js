const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/dashboard/:id_sucursal',           verificarToken, reporteController.obtenerDashboard);
router.get('/dashboard-completo/:id_sucursal',  verificarToken, reporteController.obtenerDashboardCompleto);
router.get('/periodo/:id_sucursal',             verificarToken, reporteController.obtenerReportePeriodo);
router.get('/dia-detalle/:id_sucursal',         verificarToken, reporteController.obtenerDesgloseDia);

module.exports = router;