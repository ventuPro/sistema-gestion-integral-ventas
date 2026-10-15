const groq        = require('../ia/groq');
const { crearLimite }  = require('../ia/limite');
const { marcarEvento } = require('../auditoria/registroAcceso');
const asistenteCliente = require('../ia/asistenteCliente');
const asistenteInterno = require('../ia/asistenteInterno');

// ─── Asistentes con IA ───
// La conversación la guarda el navegador y llega completa en cada mensaje; aquí
// se recorta. Las respuestas se basan solo en datos de la BD.
const MAX_MENSAJES = 10;
const MAX_TEXTO    = 500;
const superaLimite = crearLimite(60 * 60 * 1000);   // ventana de una hora

// Preguntas por hora (IA_LIMITE_* los reemplazan en pruebas). En el local varios
// celulares comparten la IP del WiFi: el límite fino es por celular.
const LIMITE = {
    celular: () => Number(process.env.IA_LIMITE_CLIENTE) || 20,
    ip:      () => Number(process.env.IA_LIMITE_IP)      || 150,
    usuario: () => Number(process.env.IA_LIMITE_INTERNO) || 60
};
const CLIENTE_MESA = /^[0-9a-f]{32}$/;

/** [{ rol: 'usuario' | 'asistente', texto }] → formato de Groq; null si no es válida */
const normalizarMensajes = (lista) => {
    if (!Array.isArray(lista) || !lista.length) return null;
    const mensajes = lista.slice(-MAX_MENSAJES).map(m => ({
        role:    m?.rol === 'asistente' ? 'assistant' : 'user',
        content: String(m?.texto ?? '').trim().slice(0, MAX_TEXTO)
    }));
    const ultimo = mensajes.at(-1);
    if (ultimo.role !== 'user' || !ultimo.content || mensajes.some(m => !m.content)) return null;
    return mensajes;
};

const auditar = (res, asistente, mensajes, r) =>
    marcarEvento(res, 'IA_CONSULTA', {
        asistente, modelo: r.modelo, tokens: r.tokens, funciones: r.herramientas,
        pregunta: mensajes.at(-1).content.slice(0, 200)
    });

// POST /api/menu/m/:codigo/asistente  { mensajes }
const cliente = async (req, res) => {
    try {
        if (!groq.disponible())
            return res.status(409).json({ error: 'El asistente no está disponible.', codigo: 'NO_DISPONIBLE' });

        const mensajes = normalizarMensajes(req.body?.mensajes);
        if (!mensajes) return res.status(400).json({ error: 'Escribe tu pregunta.' });

        const celular = CLIENTE_MESA.test(String(req.body?.cliente_mesa || '')) ? req.body.cliente_mesa : req.ip;
        if (superaLimite(`celular:${celular}`, LIMITE.celular()) || superaLimite(`ip:${req.ip}`, LIMITE.ip()))
            return res.status(429).json({ error: 'Hiciste muchas preguntas seguidas. Intenta más tarde o consulta en caja.', codigo: 'LIMITE' });

        const r = await asistenteCliente.responder(req.mesa, mensajes);
        auditar(res, 'cliente', mensajes, r);
        res.json({ respuesta: r.texto });
    } catch (e) {
        groq.responderError(res, e, 'asistente cliente');
    }
};

// POST /api/asistente  { mensajes } (personal con sesión)
const interno = async (req, res) => {
    try {
        if (!groq.disponible())
            return res.status(409).json({ error: 'El asistente no está disponible.', codigo: 'NO_DISPONIBLE' });

        const mensajes = normalizarMensajes(req.body?.mensajes);
        if (!mensajes) return res.status(400).json({ error: 'Escribe tu pregunta.' });

        if (superaLimite(`usuario:${req.usuario.id_usuario}`, LIMITE.usuario()))
            return res.status(429).json({ error: 'Alcanzaste el límite de preguntas por hora. Intenta más tarde.', codigo: 'LIMITE' });

        const r = await asistenteInterno.responder(req.usuario, mensajes);
        auditar(res, 'interno', mensajes, r);
        res.json({ respuesta: r.texto });
    } catch (e) {
        groq.responderError(res, e, 'asistente interno');
    }
};

module.exports = { cliente, interno };
