const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cajaController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Estado completo del cajero (fuente de verdad para front)
router.get   ('/estado-completo/:id_usuario', verificarToken, ctrl.getEstadoCompleto);
router.get   ('/estado-completo',             verificarToken, ctrl.getEstadoCompleto);

// Estado simple (legacy)
router.get   ('/estado/:id_usuario',           verificarToken, ctrl.getEstadoCaja);

// Control admin desde Usuarios
router.patch ('/habilitar/:id_usuario',        verificarToken, ctrl.habilitarCajaUsuario);
router.patch ('/deshabilitar/:id_usuario',     verificarToken, ctrl.deshabilitarCajaUsuario);
router.post  ('/reabrir/:id_usuario',          verificarToken, ctrl.reabrirCajaAdmin);

// Turnos
router.get   ('/turno-hoy',                    verificarToken, ctrl.getTurnoHoy);
router.post  ('/turnos/abrir',                 verificarToken, ctrl.abrirCaja);
router.post  ('/cerrar',                       verificarToken, ctrl.cerrarCaja);

// Arqueo y ventas
router.get   ('/arqueo/:id_sucursal',          verificarToken, ctrl.getArqueoHoy);
router.get   ('/ventas-hoy/:id_sucursal',      verificarToken, ctrl.getVentasHoyPOS);
router.get   ('/cierres',                      verificarToken, ctrl.getCierresCaja);
router.post  ('/cobrar',                       verificarToken, ctrl.cobrarVenta);
router.get   ('/estado-sucursal/:id_sucursal', verificarToken, ctrl.getEstadoCajaSucursal);

module.exports = router;
