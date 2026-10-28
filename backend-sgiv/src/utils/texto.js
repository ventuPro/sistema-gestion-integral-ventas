// ─── Reglas de texto compartidas ───

/** Nombres de personas y categorías: letras, espacios y . ' - */
const SOLO_LETRAS = /^[\p{L}\s.'-]+$/u;
const soloLetras = (valor) => SOLO_LETRAS.test(String(valor ?? ''));

/** Inventario se guarda en mayúsculas (null/undefined se respetan) */
const mayusculas = (valor) => valor == null ? valor : String(valor).toLocaleUpperCase('es');

module.exports = { soloLetras, mayusculas };
