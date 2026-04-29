const express = require('express');
const router = express.Router();
const reporteController = require('../controllers/reporteController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/dashboard/:id_sucursal',          verificarToken, reporteController.obtenerDashboard);
router.get('/periodo/:id_sucursal',            verificarToken, reporteController.obtenerReportePeriodo);

module.exports = router;