// ─── Métodos de pago (fijos; cada uno se habilita en configuracion) ───
const METODO_PAGO = Object.freeze({ efectivo: 'Efectivo', qr: 'QR' });

// Método → columna de configuracion que lo habilita, y motivo si está apagado
const HABILITACION = Object.freeze({
    [METODO_PAGO.efectivo]: { campo: 'pago_efectivo', motivo: 'El pago en efectivo está deshabilitado' },
    [METODO_PAGO.qr]:       { campo: 'pago_qr',       motivo: 'El pago por QR está deshabilitado' }
});

module.exports = { METODO_PAGO, HABILITACION };
