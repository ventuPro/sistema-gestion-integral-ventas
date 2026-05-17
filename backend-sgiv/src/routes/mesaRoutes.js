const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mesaController');
const { verificarToken } = require('../middlewares/authMiddleware');

router.post   ('/',                    verificarToken, ctrl.agregarMesa);
router.get    ('/sucursal/:id_sucursal', verificarToken, ctrl.listarMesas);
router.get    ('/:id_mesa/qr',         verificarToken, ctrl.obtenerQR);
router.patch  ('/:id_mesa/estado',     verificarToken, ctrl.actualizarEstado);
router.delete ('/:id_mesa',            verificarToken, ctrl.eliminarMesa);   // ← NUEVO

module.exports = router;