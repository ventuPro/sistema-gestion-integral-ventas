const telegram = require('../utils/telegram');
const telegramModel = require('../models/telegramModel');
const notificacionModel = require('../models/notificacionModel');
const ajusteModel = require('../models/ajusteModel');
const contexto = require('../auditoria/contexto');

// ─── Bot de Telegram ───
// 1. Vincular: /start → botón «Compartir mi número» → si es el teléfono registrado en Ajustes, queda vinculado.
// 2. Avisos: cada notificación se envía a los chats que la reciben.
// Sin dirección pública el bot lee los mensajes con consultas largas (getUpdates).

const CONTEXTO = { usuario: 'Sistema', origen: 'Bot de Telegram' };

const nombreNegocio = async () => (await ajusteModel.obtener())?.nombre_comercial || 'el sistema';

const BOTON_NUMERO = { keyboard: [[{ text: 'Compartir mi número', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
const SIN_BOTONES  = { remove_keyboard: true };

/** Un mensaje recibido por el bot */
const procesarActualizacion = async (act) => {
    const m = act?.message;
    if (!m?.chat?.id || m.chat.type !== 'private') return;
    const chat = m.chat.id;

    if (m.contact) {
        // Solo vale el número propio (Telegram lo garantiza cuando el contacto es del mismo usuario)
        if (m.contact.user_id !== m.from?.id)
            return telegram.enviar(chat, 'Comparte tu propio número con el botón de abajo.', { reply_markup: BOTON_NUMERO });
        const u = await contexto.ejecutar({ ...CONTEXTO }, () => telegramModel.vincular(m.contact.phone_number, chat));
        if (!u) return telegram.enviar(chat,
            'Este número no está registrado. Pide al administrador que lo agregue en Ajustes → Telegram y vuelve a intentarlo.',
            { reply_markup: SIN_BOTONES });
        return telegram.enviar(chat,
            `Listo, ${u.nombre_completo}. Desde ahora recibirás aquí los avisos de ${await nombreNegocio()} y el código para ingresar al sistema.`,
            { reply_markup: SIN_BOTONES });
    }

    return telegram.enviar(chat,
        `Hola. Para recibir los avisos y los códigos de ingreso de ${await nombreNegocio()}, toca «Compartir mi número».`,
        { reply_markup: BOTON_NUMERO });
};

// ─── Avisos: cada notificación nueva también va a Telegram ───
const enviarAviso = async (n) => {
    if (!telegram.activo()) return;
    try {
        const chats = await telegramModel.destinatarios(n);
        const texto = `${n.titulo}\n${n.mensaje}`;
        await Promise.allSettled(chats.map(chat => telegram.enviar(chat, texto)));
    } catch (e) {
        console.error('Telegram (aviso):', e.message);
    }
};
let registrado = false;
const registrarAvisos = () => {
    if (registrado) return;
    registrado = true;
    notificacionModel.alCrear(enviarAviso);
};

// ─── Lectura de mensajes (consultas largas) ───
let activo = false;
const iniciar = async () => {
    if (!telegram.activo() || activo) return;
    activo = true;
    let desde = 0;
    while (activo) {
        try {
            const actualizaciones = await telegram.llamar('getUpdates',
                { offset: desde, timeout: 25, allowed_updates: ['message'] }, { esperaMs: 35_000 });
            for (const a of actualizaciones) {
                desde = a.update_id + 1;
                await procesarActualizacion(a).catch(e => console.error('Telegram (mensaje):', e.message));
            }
        } catch (e) {
            console.error('Telegram (lectura):', e.message);
            await new Promise(r => setTimeout(r, 15_000));
        }
    }
};
const detener = () => { activo = false; };

module.exports = { procesarActualizacion, registrarAvisos, iniciar, detener };
