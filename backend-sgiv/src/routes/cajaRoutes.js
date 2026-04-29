const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.post('/turnos/abrir',   verificarToken, cajaController.abrirCaja);
router.post('/cobrar',         verificarToken, cajaController.cobrarVenta);
router.get('/arqueo',          verificarToken, cajaController.obtenerArqueo);
router.post('/cierre-diario',  verificarToken, cajaController.cierreDiario);

module.exports = router;