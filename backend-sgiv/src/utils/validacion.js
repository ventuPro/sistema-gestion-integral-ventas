// ─── Validación de campos (las mismas reglas que frontend-sgiv/src/app/core/utils/validacion.ts) ───

const REGLAS = {
    celular:   { patron: /^[67]\d{7}$/, digitos: true,
                 mensaje: 'Celular inválido: 8 dígitos que empiezan con 6 o 7.' },
    telefono:  { patron: /^([67]\d{7}|[234]\d{6,7})$/, digitos: true,
                 mensaje: 'Teléfono inválido: celular de 8 dígitos que empieza con 6 o 7, o fijo que empieza con 2, 3 o 4 (ej. 2412345).' },
    letras:    { patron: /^\p{L}[\p{L}\s.'-]*$/u, minimo: 2, letra: true, mensaje: 'solo admite letras.' },
    persona:   { patron: /^\p{L}[\p{L}\s.'-]*$/u, minimo: 3, letra: true, mensaje: 'solo admite letras.' },
    nombre:    { patron: /^[\p{L}\d][\p{L}\d\s.,&()#%'’°º-]*$/u, minimo: 2, letra: true,
                 mensaje: 'debe empezar con una letra o número y solo admite letras, números, espacios y . , - & ( ) # %' },
    direccion: { patron: /^[\p{L}\d][\p{L}\d\s.,#°º/()'’-]*$/u, minimo: 5, letra: true,
                 mensaje: 'solo admite letras, números, espacios y . , # / - ( )' },
    texto:     { patron: /^[^<>{}[\]\\^`|~*=_]*$/, mensaje: 'tiene caracteres no permitidos (< > { } [ ] * = _ …).' },
    ci:        { patron: /^\d{5,10}(-[0-9A-Z]{1,2})?( ?(LP|CB|SC|OR|PT|CH|TJ|BE|PD))?$/, mayusculas: true,
                 mensaje: 'CI inválido: de 5 a 10 dígitos, complemento y extensión opcionales (ej. 1234567-1A LP).' },
    nit:       { patron: /^\d{6,13}$/, mensaje: 'NIT inválido: de 6 a 13 dígitos.' },
    correo:    { patron: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, minusculas: true, mensaje: 'Correo inválido (ej. nombre@correo.com).' },
    url:       { patron: /^https?:\/\/[^\s/.]+\.[^\s]+$/i, mensaje: 'El enlace debe empezar con https:// (ej. https://www.negocio.com).' },
    moneda:    { patron: /^[\p{L}$][\p{L}.$]{0,4}$/u, mensaje: 'Moneda inválida (ej. Bs. o $us).' }
};

// ─── Texto con sentido (contra «suc44444444», «aaaaaa», «sdfghjk») ───
const SENTIDO = {
    letras:    { palabra: 20, numeros: 0 },
    persona:   { palabra: 20, numeros: 0 },
    nombre:    { palabra: 22, numeros: 6 },
    direccion: { palabra: 22, numeros: 6 },
    texto:     { palabra: 0,  numeros: 0 }
};

/** Mensaje si el texto no tiene sentido, o '' si está bien */
const sinSentido = (t, regla) => {
    const s = SENTIDO[regla];
    if (!s) return '';
    // En textos libres no se revisan enlaces ni correos
    if (regla === 'texto') t = t.split(/\s+/).filter(p => !/[@:/]|www\./i.test(p)).join(' ');
    if (/(\p{L})\1{2}/iu.test(t) || /(\d)\1{3}/.test(t) || /([^\p{L}\d\s])\1{3}/u.test(t))
        return 'tiene un carácter repetido demasiadas veces.';
    if (s.palabra && t.split(/\s+/).some(p => p.length > s.palabra)) return `tiene una palabra de más de ${s.palabra} letras.`;
    if (s.numeros && new RegExp(`\\d{${s.numeros + 1}}`).test(t)) return `tiene más de ${s.numeros} números seguidos.`;
    const llano = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const ilegible = (llano.match(/\p{L}+/gu) || []).some(p => (p.length >= 4 && !/[aeiouy]/.test(p)) || /[^aeiouy]{5}/.test(p));
    return ilegible ? 'tiene palabras que no se pueden leer.' : '';
};

class ErrorValidacion extends Error {
    constructor(mensaje) { super(mensaje); this.code = 'VALIDACION'; this.status = 400; }
}

const LETRA = /\p{L}/u;

/**
 * Limpia y valida un texto. Vacío → null (o error si es obligatorio).
 * opciones: { etiqueta, obligatorio, max, minimo, multilinea }
 */
const revisar = (valor, regla, { etiqueta = 'El campo', obligatorio = false, max = null, minimo = null, multilinea = false } = {}) => {
    const r = REGLAS[regla];
    if (regla && !r) throw new Error(`Regla desconocida: ${regla}`);
    let t = valor == null ? '' : String(valor);
    t = multilinea ? t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
                   : t.replace(/\s+/g, ' ').trim();
    if (r?.digitos) {
        t = t.replace(/[\s()+-]/g, '');
        if (/^591\d{7,8}$/.test(t)) t = t.slice(3);
    }
    if (r?.minusculas) t = t.toLowerCase();
    if (r?.mayusculas) t = t.toUpperCase();
    if (!t) {
        if (obligatorio) throw new ErrorValidacion(`${etiqueta} es obligatorio.`);
        return null;
    }
    const min = minimo ?? r?.minimo ?? 0;
    if (t.length < min) throw new ErrorValidacion(`${etiqueta} debe tener al menos ${min} caracteres.`);
    if (max && t.length > max) throw new ErrorValidacion(`${etiqueta} admite hasta ${max} caracteres.`);
    if (r) {
        const mensaje = /^[a-z]/.test(r.mensaje) ? `${etiqueta} ${r.mensaje}` : r.mensaje;
        if (!r.patron.test(t)) throw new ErrorValidacion(mensaje);
        if (r.letra && !LETRA.test(t)) throw new ErrorValidacion(`${etiqueta} debe tener letras.`);
        const absurdo = sinSentido(t, regla);
        if (absurdo) throw new ErrorValidacion(`${etiqueta} ${absurdo}`);
    }
    return t;
};

/** Número dentro de un rango. Vacío → null (o error si es obligatorio). */
const numero = (valor, { etiqueta = 'El valor', obligatorio = false, min = null, max = null, entero = false } = {}) => {
    if (valor === null || valor === undefined || valor === '') {
        if (obligatorio) throw new ErrorValidacion(`${etiqueta} es obligatorio.`);
        return null;
    }
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new ErrorValidacion(`${etiqueta} debe ser un número.`);
    if (entero && !Number.isInteger(n)) throw new ErrorValidacion(`${etiqueta} debe ser un número entero.`);
    if (min !== null && n < min) throw new ErrorValidacion(`${etiqueta} debe ser mayor o igual a ${min}.`);
    if (max !== null && n > max) throw new ErrorValidacion(`${etiqueta} debe ser menor o igual a ${max}.`);
    return n;
};

module.exports = { REGLAS, SENTIDO, ErrorValidacion, revisar, numero, sinSentido };
