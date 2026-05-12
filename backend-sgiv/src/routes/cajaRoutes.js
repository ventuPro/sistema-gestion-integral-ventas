const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cajaController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Control de caja (Admin)
router.get   ('/estado/:id_usuario',         verificarToken, ctrl.getEstadoCaja);
router.patch ('/habilitar/:id_usuario',      verificarToken, ctrl.habilitarCajaUsuario);
router.patch ('/deshabilitar/:id_usuario',   verificarToken, ctrl.deshabilitarCajaUsuario);

// Arqueo del día
router.get   ('/arqueo/:id_sucursal',        verificarToken, ctrl.getArqueoHoy);

// Ventas hoy (para POS)
router.get   ('/ventas-hoy/:id_sucursal',    verificarToken, ctrl.getVentasHoyPOS);

// Turno y ventas
router.post  ('/turnos/abrir',               verificarToken, ctrl.abrirCaja);
router.post  ('/cobrar',                     verificarToken, ctrl.cobrarVenta);
router.post  ('/cerrar',                     verificarToken, ctrl.cerrarCaja);
router.get('/cierres',                       verificarToken, ctrl.getCierresCaja);
router.get('/turno-hoy',                     verificarToken, ctrl.getTurnoHoy);

module.exports = router;