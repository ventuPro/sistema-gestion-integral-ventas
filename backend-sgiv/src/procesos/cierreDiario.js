const cajaModel = require('../models/cajaModel');
const listaDiaModel = require('../models/listaDiaModel');
const contexto  = require('../auditoria/contexto');
const { emitirUsuario, emitirCajeros } = require('../utils/tiempoReal');

// ─── Cierre del día (00:00, hora de La Paz) ───
// Revisa cada minuto (y al arrancar, por si el servidor estuvo apagado a medianoche).
const CONTEXTO = { usuario: 'Sistema', origen: 'Proceso automático: cierre del día (00:00)' };

const ejecutar = () => contexto.ejecutar({ ...CONTEXTO }, async () => {
    try {
        const turnos = await cajaModel.cerrarTurnosVencidos();
        for (const t of turnos) {
            const datos = { id_turno: t.id_turno, id_usuario: t.id_usuario_cajero, id_sucursal: t.id_sucursal, por: 'Sistema' };
            emitirUsuario(t.id_usuario_cajero, 'caja:cerrada', datos);
            emitirCajeros('caja:cerrada', datos);
        }
        if (turnos.length) console.log(`Cierre del día: ${turnos.length} turno(s) cerrados por el sistema`);
        // Después de cerrar las cajas: foto del stock con el que terminó el día
        const fotos = await listaDiaModel.tomarFotos();
        if (fotos.length) emitirCajeros('lista_dia:actualizada', {});
    } catch (e) {
        console.error('cierreDiario:', e.message);
    }
});

const iniciar = () => {
    ejecutar();
    return setInterval(ejecutar, 60_000).unref();
};

module.exports = { iniciar, ejecutar };
