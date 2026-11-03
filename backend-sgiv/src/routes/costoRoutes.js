const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/costoController');
const { verificarToken, soloAdministrador } = require('../middlewares/authMiddleware');

// ─── Costos de producción: solo el administrador ───
router.use(verificarToken, soloAdministrador);

router.get   ('/unidades',               ctrl.unidades);

router.get   ('/insumos',                ctrl.listarInsumos);
router.post  ('/insumos',                ctrl.crearInsumo);
router.put   ('/insumos/:id',            ctrl.actualizarInsumo);
router.delete('/insumos/:id',            ctrl.eliminarInsumo);
router.get   ('/insumos/:id/historial',  ctrl.historialInsumo);

router.get   ('/recetas',                ctrl.listarRecetas);
router.get   ('/recetas/:id',            ctrl.obtenerReceta);
router.post  ('/recetas',                ctrl.crearReceta);
router.put   ('/recetas/:id',            ctrl.actualizarReceta);
router.delete('/recetas/:id',            ctrl.eliminarReceta);
router.get   ('/recetas/:id/historial',  ctrl.historialReceta);

module.exports = router;
