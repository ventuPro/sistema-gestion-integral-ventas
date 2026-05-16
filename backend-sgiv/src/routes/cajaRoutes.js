const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cajaController');
const { verificarToken } = require('../middlewares/authMiddleware');

// --- Control de Caja (Admin / Estado) ---
router.get   ('/estado/:id_usuario',       verificarToken, ctrl.getEstadoCaja);
router.patch ('/habilitar/:id_usuario',    verificarToken, ctrl.habilitarCajaUsuario);
router.patch ('/deshabilitar/:id_usuario', verificarToken, ctrl.deshabilitarCajaUsuario);

// --- Verificación y Turnos ---
// Esta es la ruta de verificación que faltaba para el turno actual
router.get   ('/turno-hoy',                verificarToken, ctrl.getTurnoHoy);
router.post  ('/turnos/abrir',             verificarToken, ctrl.abrirCaja);

// --- Operaciones de Venta y Arqueo ---
router.get   ('/arqueo/:id_sucursal',      verificarToken, ctrl.getArqueoHoy);
router.get   ('/ventas-hoy/:id_sucursal',  verificarToken, ctrl.getVentasHoyPOS);
router.post  ('/cobrar',                   verificarToken, ctrl.cobrarVenta);

// --- Cierres e Historial ---
router.post  ('/cerrar',                   verificarToken, ctrl.cerrarCaja);
router.get   ('/cierres',                  verificarToken, ctrl.getCierresCaja);

module.exports = router;