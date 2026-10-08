const crypto     = require('crypto');
const svgCaptcha = require('svg-captcha');

// ─── CAPTCHA propio (funciona sin internet) ───
// El texto se dibuja como trazos SVG: no aparece como texto en la imagen.
// Cada CAPTCHA es de un solo uso y vence a los 5 minutos.
const VIGENCIA_MS = 5 * 60 * 1000;
const MAX_VIVOS   = 5000;
const pendientes  = new Map();   // id → { texto, expira }

setInterval(() => {
    const ahora = Date.now();
    for (const [id, c] of pendientes) if (c.expira < ahora) pendientes.delete(id);
}, 60 * 1000).unref();

const crear = () => {
    const { text, data } = svgCaptcha.create({
        size: 5,
        ignoreChars: '0oO1iIlLuvVwW',
        noise: 3,
        color: true,
        background: '#eff6ff',
        width: 160,
        height: 56,
        fontSize: 52
    });
    if (pendientes.size >= MAX_VIVOS) pendientes.delete(pendientes.keys().next().value);

    const id = crypto.randomBytes(16).toString('hex');
    pendientes.set(id, { texto: text.toLowerCase(), expira: Date.now() + VIGENCIA_MS });
    return { id, texto: text, svg: data };
};

/** Consume el CAPTCHA (válido o no) y devuelve si la respuesta es correcta. */
const verificar = (id, respuesta) => {
    const c = pendientes.get(String(id || ''));
    if (!c) return false;
    pendientes.delete(String(id));
    if (c.expira < Date.now()) return false;
    const dada = Buffer.from(String(respuesta || '').trim().toLowerCase());
    const real = Buffer.from(c.texto);
    return dada.length === real.length && crypto.timingSafeEqual(dada, real);
};

module.exports = { crear, verificar };
