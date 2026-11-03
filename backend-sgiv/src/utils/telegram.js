// ─── Cliente del bot de Telegram (API gratuita) ───
// Clave en .env: TELEGRAM_BOT_TOKEN. Sin clave, Telegram queda apagado (sin avisos ni código en el login).
// TELEGRAM_URL solo para pruebas (servidor falso).

const base   = () => process.env.TELEGRAM_URL || 'https://api.telegram.org';
const token  = () => process.env.TELEGRAM_BOT_TOKEN || '';
const activo = () => !!token();

const llamar = async (metodo, datos = {}, { esperaMs = 10_000 } = {}) => {
    if (!activo()) throw new Error('Telegram no está configurado');
    const r = await fetch(`${base()}/bot${token()}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
        signal: AbortSignal.timeout(esperaMs)
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok || !cuerpo.ok) {
        const e = new Error(cuerpo.description || `Telegram respondió ${r.status}`);
        e.status = r.status;
        throw e;
    }
    return cuerpo.result;
};

const enviar = (chat_id, texto, extra = {}) =>
    llamar('sendMessage', { chat_id, text: texto, disable_web_page_preview: true, ...extra });

// Nombre del bot (para el enlace t.me/<usuario>); se guarda en memoria
let bot = null;
const datosBot = async () => {
    if (bot && bot.token === token()) return bot.datos;
    const datos = await llamar('getMe');
    bot = { token: token(), datos };
    return datos;
};

/** Solo dígitos y con código de país (Bolivia 591 si se escribió el número local de 8 dígitos) */
const normalizarTelefono = (texto) => {
    const d = String(texto ?? '').replace(/\D/g, '');
    if (!d) return null;
    return d.length === 8 ? `591${d}` : d;
};

module.exports = { activo, llamar, enviar, datosBot, normalizarTelefono };
