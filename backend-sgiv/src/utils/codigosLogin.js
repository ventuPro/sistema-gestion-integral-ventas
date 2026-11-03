const crypto = require('crypto');

// ─── Segundo paso del inicio de sesión ───
// Tras la contraseña correcta se crea un «desafío»: un código de 6 dígitos enviado por Telegram
// o, si Telegram no respondió, el CAPTCHA (alterno). Vive en memoria 5 minutos.

const VIGENCIA_MS     = 5 * 60 * 1000;
const MAX_INTENTOS    = 5;
const ESPERA_REENVIO  = 30 * 1000;
const desafios = new Map();   // id → { id_usuario, correo, hash, vence, intentos, alterno, enviado }

setInterval(() => {
    const ahora = Date.now();
    for (const [id, d] of desafios) if (d.vence < ahora) desafios.delete(id);
}, 60 * 1000).unref();

const resumen = (codigo) => crypto.createHash('sha256').update(String(codigo)).digest('hex');
const nuevoCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Crea el desafío; devuelve { id, codigo } (codigo null si es alterno) */
const crear = (id_usuario, correo, { alterno = false } = {}) => {
    const id = crypto.randomBytes(16).toString('hex');
    const codigo = alterno ? null : nuevoCodigo();
    desafios.set(id, { id_usuario, correo, hash: codigo && resumen(codigo), vence: Date.now() + VIGENCIA_MS,
                       intentos: 0, alterno, enviado: Date.now() });
    return { id, codigo };
};

const obtener = (id) => {
    const d = desafios.get(String(id || ''));
    if (!d) return null;
    if (d.vence < Date.now()) { desafios.delete(String(id)); return null; }
    return d;
};

/** { ok } | { ok: false, motivo: 'VENCIDO' | 'INCORRECTO' | 'AGOTADO' } */
const verificarCodigo = (id, codigo) => {
    const d = obtener(id);
    if (!d || d.alterno) return { ok: false, motivo: 'VENCIDO' };
    const a = Buffer.from(resumen(String(codigo || '').trim()));
    const b = Buffer.from(d.hash);
    if (crypto.timingSafeEqual(a, b)) { desafios.delete(String(id)); return { ok: true, id_usuario: d.id_usuario }; }
    d.intentos++;
    if (d.intentos >= MAX_INTENTOS) { desafios.delete(String(id)); return { ok: false, motivo: 'AGOTADO' }; }
    return { ok: false, motivo: 'INCORRECTO', quedan: MAX_INTENTOS - d.intentos };
};

/** Paso alterno (Telegram no respondió): se consume al usarlo */
const usarAlterno = (id) => {
    const d = obtener(id);
    if (!d || !d.alterno) return null;
    desafios.delete(String(id));
    return d.id_usuario;
};

/** Código nuevo para el mismo desafío; null si es pronto o ya no existe */
const renovar = (id) => {
    const d = obtener(id);
    if (!d || d.alterno || Date.now() - d.enviado < ESPERA_REENVIO) return null;
    const codigo = nuevoCodigo();
    Object.assign(d, { hash: resumen(codigo), vence: Date.now() + VIGENCIA_MS, intentos: 0, enviado: Date.now() });
    return { codigo, id_usuario: d.id_usuario };
};

/** Telegram falló al reenviar: pasa a CAPTCHA */
const pasarAAlterno = (id) => { const d = obtener(id); if (d) Object.assign(d, { alterno: true, hash: null }); };

const limpiar = () => desafios.clear();

module.exports = { crear, obtener, verificarCodigo, usarAlterno, renovar, pasarAAlterno, limpiar, VIGENCIA_MS, ESPERA_REENVIO };
