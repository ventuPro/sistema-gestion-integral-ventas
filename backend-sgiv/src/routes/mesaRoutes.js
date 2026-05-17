const express         = require('express');
const router          = express.Router();
const mesaController  = require('../controllers/mesaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.get('/',                       verificarToken, mesaController.listarMesas);
router.get('/sucursal/:id_sucursal',  verificarToken, mesaController.listarMesas);
router.post('/',                      verificarToken, mesaController.agregarMesa);
router.get('/:id_mesa/qr',            verificarToken, mesaController.obtenerQR);
router.patch('/:id_mesa/estado',      verificarToken, mesaController.actualizarEstado);

module.exports = router;