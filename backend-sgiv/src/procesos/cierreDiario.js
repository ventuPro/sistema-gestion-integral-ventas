const cajaModel = require('../models/cajaModel');
const notificacionModel = require('../models/notificacionModel');
const loteModel = require('../models/loteModel');
const db = require('../config/db');
const contexto  = require('../auditoria/contexto');
const { emitirUsuario, emitirCajeros } = require('../utils/tiempoReal');

// ─── Cierre del día (00:00, hora de La Paz) ───
// Revisa cada minuto (y al arrancar, por si el servidor estuvo apagado a medianoche).
const CONTEXTO = { usuario: 'Sistema', origen: 'Proceso automático: cierre del día (00:00)' };

// Lotes = stock: se revisa al arrancar y cada hora (corrige solo si alguien tocó la BD a mano)
const CADA_HORA = 60 * 60_000;
let ultimaRevisionLotes = 0;
// Avisos de «por vencer» y «vencido» (campana y Telegram)
const CADA_10_MIN = 10 * 60_000;
let ultimaRevisionVencimientos = 0;

const ejecutar = () => contexto.ejecutar({ ...CONTEXTO }, async () => {
    try {
        const turnos = await cajaModel.cerrarTurnosVencidos();
        for (const t of turnos) {
            const datos = { id_turno: t.id_turno, id_usuario: t.id_usuario_cajero, id_sucursal: t.id_sucursal, por: 'Sistema' };
            emitirUsuario(t.id_usuario_cajero, 'caja:cerrada', datos);
            emitirCajeros('caja:cerrada', datos);
        }
        if (turnos.length) console.log(`Cierre del día: ${turnos.length} turno(s) cerrados por el sistema`);
        await notificacionModel.limpiarAntiguas();
        if (Date.now() - ultimaRevisionLotes >= CADA_HORA) {
            ultimaRevisionLotes = Date.now();
            const corregidos = await loteModel.cuadrarTodos(db);
            if (corregidos) console.warn(`Lotes: ${corregidos} producto(s) corregidos para que coincidan con el stock`);
        }
        if (Date.now() - ultimaRevisionVencimientos >= CADA_10_MIN) {
            ultimaRevisionVencimientos = Date.now();
            await notificacionModel.vencimientos();
        }
    } catch (e) {
        console.error('cierreDiario:', e.message);
    }
});

const iniciar = () => {
    ejecutar();
    return setInterval(ejecutar, 60_000).unref();
};

module.exports = { iniciar, ejecutar };
