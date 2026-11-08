// ─── Validación de campos (las mismas reglas que backend-sgiv/src/utils/validacion.js) ───
// Cada campo lleva data-regla="…": al escribir se quita lo que no corresponde y al guardar
// se revisa el formato. También se revisan required, minlength y min/max/step de los números.

export interface Regla {
  /** Caracteres que no se pueden escribir */
  filtro?: RegExp;
  /** Formato del valor completo */
  patron: RegExp;
  mensaje: string;
  /** Largo máximo si el campo no trae maxlength */
  max?: number;
  minimo?: number;
  minuscula?: boolean;
  mayuscula?: boolean;
  /** Se revisa sin espacios, guiones ni el prefijo 591 (como en el servidor) */
  digitos?: boolean;
}

const soloDigitos = (v: string) => {
  const d = v.replace(/[\s()+-]/g, '');
  return /^591\d{7,8}$/.test(d) ? d.slice(3) : d;
};

const LETRA = /\p{L}/u;

export const REGLAS: Record<string, Regla> = {
  // Celular boliviano: 8 dígitos, empieza con 6 o 7
  celular: {
    filtro: /\D/g, max: 8, digitos: true, patron: /^[67]\d{7}$/,
    mensaje: 'Celular inválido: 8 dígitos que empiezan con 6 o 7.'
  },
  // Celular o fijo: 7 dígitos, o 8 con el código de área (2 La Paz/Oruro/Potosí,
  // 3 Santa Cruz/Beni/Pando, 4 Cochabamba/Chuquisaca/Tarija)
  telefono: {
    filtro: /\D/g, max: 8, digitos: true, patron: /^([67]\d{7}|[234]\d{6,7})$/,
    mensaje: 'Teléfono inválido: celular de 8 dígitos que empieza con 6 o 7, o fijo que empieza con 2, 3 o 4 (ej. 2412345).'
  },
  // Ciudad, país, cargo, categoría
  letras: {
    filtro: /[^\p{L}\s.'-]/gu, minimo: 2, patron: /^\p{L}[\p{L}\s.'-]*$/u,
    mensaje: 'Solo admite letras.'
  },
  // Nombres de personas
  persona: {
    filtro: /[^\p{L}\s.'-]/gu, minimo: 3, patron: /^\p{L}[\p{L}\s.'-]*$/u,
    mensaje: 'El nombre solo admite letras.'
  },
  // Nombres de sucursal, producto, insumo, receta, promoción…
  nombre: {
    filtro: /[^\p{L}\d\s.,&()#%'’°º-]/gu, minimo: 2, patron: /^[\p{L}\d][\p{L}\d\s.,&()#%'’°º-]*$/u,
    mensaje: 'El nombre debe empezar con una letra o número y solo admite letras, números, espacios y . , - & ( ) # %'
  },
  direccion: {
    filtro: /[^\p{L}\d\s.,#°º/()'’-]/gu, minimo: 5, patron: /^[\p{L}\d][\p{L}\d\s.,#°º/()'’-]*$/u,
    mensaje: 'Dirección inválida: solo letras, números, espacios y . , # / - ( )'
  },
  // Descripciones, notas, motivos, textos del menú y del ticket
  texto: {
    filtro: /[<>{}[\]\\^`|~*=_]/g, patron: /^[^<>{}[\]\\^`|~*=_]*$/,
    mensaje: 'El texto tiene caracteres no permitidos (< > { } [ ] * = _ …).'
  },
  // Carnet de identidad: 5 a 10 dígitos y complemento opcional (1234567-1A)
  ci: {
    filtro: /[^\dA-Za-z -]/g, max: 17, mayuscula: true, patron: /^\d{5,10}(-[0-9A-Z]{1,2})?( ?(LP|CB|SC|OR|PT|CH|TJ|BE|PD))?$/,
    mensaje: 'CI inválido: de 5 a 10 dígitos, complemento y extensión opcionales (ej. 1234567-1A LP).'
  },
  nit: {
    filtro: /\D/g, max: 13, patron: /^\d{6,13}$/,
    mensaje: 'NIT inválido: de 6 a 13 dígitos.'
  },
  correo: {
    filtro: /\s/g, minuscula: true, patron: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
    mensaje: 'Correo inválido (ej. nombre@correo.com).'
  },
  url: {
    filtro: /\s/g, patron: /^https?:\/\/[^\s/.]+\.[^\s]+$/i,
    mensaje: 'El enlace debe empezar con https:// (ej. https://www.negocio.com).'
  },
  moneda: {
    filtro: /[^\p{L}.$]/gu, max: 5, patron: /^[\p{L}$][\p{L}.$]{0,4}$/u,
    mensaje: 'Moneda inválida (ej. Bs. o $us).'
  }
};

// ─── Texto con sentido (contra «suc44444444», «aaaaaa», «sdfghjk») ───
export const SENTIDO: Record<string, { palabra: number; numeros: number }> = {
  letras:    { palabra: 20, numeros: 0 },
  persona:   { palabra: 20, numeros: 0 },
  nombre:    { palabra: 22, numeros: 6 },
  direccion: { palabra: 22, numeros: 6 },
  texto:     { palabra: 0,  numeros: 0 }
};

/** Mensaje si el texto no tiene sentido, o '' si está bien */
export const sinSentido = (t: string, regla: string): string => {
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

/** Quita lo que no se puede escribir según la regla del campo */
export const filtrarSegunRegla = (campo: HTMLInputElement | HTMLTextAreaElement, valor: string): string => {
  const regla = REGLAS[campo.dataset['regla'] || ''];
  if (!regla) return valor;
  if (regla.filtro) valor = valor.replace(regla.filtro, '');
  if (regla.minuscula) valor = valor.toLowerCase();
  if (regla.mayuscula) valor = valor.toUpperCase();
  if (regla.max && !campo.hasAttribute('maxlength')) valor = valor.slice(0, regla.max);
  return valor;
};

type Campo = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const etiquetaDe = (campo: Campo): string => {
  const label = campo.id ? document.querySelector(`label[for="${CSS.escape(campo.id)}"]`) : campo.closest('label');
  const texto = (label?.textContent || campo.getAttribute('aria-label') || '').replace(/\*/g, '').trim();
  return texto ? `«${texto}»` : 'Este campo';
};

/** Mensaje del primer problema del campo, o '' si está bien */
export const errorDeCampo = (campo: Campo): string => {
  if (campo.disabled || !campo.getClientRects().length) return '';
  const valor = campo.value.trim();
  if (!valor) return campo.required ? `${etiquetaDe(campo)} es obligatorio.` : '';

  if (campo instanceof HTMLInputElement && campo.type === 'number') {
    const n = Number(valor);
    if (!Number.isFinite(n)) return `${etiquetaDe(campo)} debe ser un número.`;
    const min = campo.getAttribute('min'), max = campo.getAttribute('max'), paso = campo.getAttribute('step');
    if (min !== null && n < Number(min)) return `${etiquetaDe(campo)} debe ser mayor o igual a ${min}.`;
    if (max !== null && n > Number(max)) return `${etiquetaDe(campo)} debe ser menor o igual a ${max}.`;
    if (paso === '1' && !Number.isInteger(n)) return `${etiquetaDe(campo)} debe ser un número entero.`;
    return '';
  }

  const minimo = Number(campo.getAttribute('minlength')) || REGLAS[campo.dataset['regla'] || '']?.minimo || 0;
  if (valor.length < minimo) return `${etiquetaDe(campo)} debe tener al menos ${minimo} caracteres.`;

  const regla = REGLAS[campo.dataset['regla'] || ''];
  if (regla && !regla.patron.test(regla.digitos ? soloDigitos(valor) : valor.replace(/\s+/g, ' '))) return regla.mensaje;
  const nombreRegla = campo.dataset['regla'] || '';
  if (['persona', 'letras', 'nombre', 'direccion'].includes(nombreRegla) && !LETRA.test(valor))
    return `${etiquetaDe(campo)} debe tener letras.`;
  const absurdo = sinSentido(valor.replace(/\s+/g, ' '), nombreRegla);
  if (absurdo) return `${etiquetaDe(campo)} ${absurdo}`;
  if (campo.hasAttribute('data-solo-letras') && !/^[\p{L}\s.'-]+$/u.test(valor)) return `${etiquetaDe(campo)} solo admite letras.`;
  return '';
};

/** Marca o limpia el campo; devuelve el mensaje de error */
export const marcarCampo = (campo: Campo): string => {
  const error = errorDeCampo(campo);
  campo.setCustomValidity(error);
  if (error) campo.setAttribute('aria-invalid', 'true');
  else campo.removeAttribute('aria-invalid');
  return error;
};

const CAMPOS = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]):not([type=hidden]), textarea, select';

/** Revisa todos los campos del contenedor; muestra el error del primero que falle y lo enfoca */
export const validarContenedor = (contenedor: Element): boolean => {
  let primero: Campo | null = null;
  for (const campo of contenedor.querySelectorAll<Campo>(CAMPOS))
    if (marcarCampo(campo) && !primero) primero = campo;
  if (!primero) return true;
  primero.focus();
  primero.reportValidity();
  return false;
};
