const crypto = require('crypto');

// ─── TOTP (RFC 6238), compatible con Google/Microsoft Authenticator ───
const PERIODO_S   = 30;
const DIGITOS     = 6;
const TOLERANCIA  = 1;   // pasos aceptados antes/después (desfase de reloj)
const ALFABETO    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Codificar = (buffer) => {
    let bits = 0, valor = 0, salida = '';
    for (const byte of buffer) {
        valor = (valor << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            salida += ALFABETO[(valor >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
    return salida;
};

const base32Decodificar = (texto) => {
    const limpio = String(texto).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0, valor = 0;
    const bytes = [];
    for (const c of limpio) {
        const i = ALFABETO.indexOf(c);
        if (i === -1) throw new Error('Base32 inválido');
        valor = (valor << 5) | i;
        bits += 5;
        if (bits >= 8) {
            bytes.push((valor >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
};

const generarSecreto = () => base32Codificar(crypto.randomBytes(20));

const pasoActual = (ms = Date.now()) => Math.floor(ms / 1000 / PERIODO_S);

const codigoParaPaso = (secreto, paso) => {
    const contador = Buffer.alloc(8);
    contador.writeBigUInt64BE(BigInt(paso));
    const hmac = crypto.createHmac('sha1', base32Decodificar(secreto)).update(contador).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const numero = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITOS;
    return String(numero).padStart(DIGITOS, '0');
};

/** Devuelve el paso que coincide con el código, o null. */
const verificar = (secreto, codigo, ms = Date.now()) => {
    const limpio = String(codigo || '').replace(/\s/g, '');
    if (!new RegExp(`^\\d{${DIGITOS}}$`).test(limpio)) return null;
    const actual = pasoActual(ms);
    let encontrado = null;
    for (let d = -TOLERANCIA; d <= TOLERANCIA; d++) {
        const esperado = codigoParaPaso(secreto, actual + d);
        if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio)) && encontrado === null)
            encontrado = actual + d;
    }
    return encontrado;
};

const uriOtpauth = (secreto, cuenta, emisor) => {
    const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
    const params = new URLSearchParams({
        secret: secreto, issuer: emisor, algorithm: 'SHA1',
        digits: String(DIGITOS), period: String(PERIODO_S)
    });
    return `otpauth://totp/${etiqueta}?${params}`;
};

module.exports = {
    generarSecreto, verificar, uriOtpauth, codigoParaPaso, pasoActual,
    base32Codificar, base32Decodificar
};
