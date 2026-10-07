const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/mesaController');
const { verificarToken, verificarPermiso } = require('../middlewares/authMiddleware');

const mesas = [verificarToken, verificarPermiso('mesas')];

router.post   ('/',                    mesas, ctrl.agregarMesa);
router.get    ('/sucursal/:id_sucursal', mesas, ctrl.listarMesas);
router.get    ('/:id_mesa/qr',         mesas, ctrl.obtenerQR);
router.post   ('/:id_mesa/qr/regenerar', mesas, ctrl.regenerarQR);
router.patch  ('/:id_mesa/estado',     mesas, ctrl.actualizarEstado);
router.delete ('/:id_mesa',            mesas, ctrl.eliminarMesa);

module.exports = router;