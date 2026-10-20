// ─── Ficha del producto en el menú QR: ingredientes, preparación y categorías ───

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// El primero que coincide gana (por eso «dulce de leche» va antes que «leche»)
const EMOJI_INGREDIENTE: [RegExp, string][] = [
  [/dulce de leche|manjar|caramelo|flan/, '🍮'],
  [/chocolate|cacao|nutella/, '🍫'],
  [/oreo|galleta/, '🍪'],
  [/huevo|yema|clara/, '🥚'],
  [/leche|yogur/, '🥛'],
  [/harina|trigo|avena|integral/, '🌾'],
  [/maicena|maiz|choclo/, '🌽'],
  [/mantequilla|margarina/, '🧈'],
  [/crema|nata|chantilly|merengue|helado/, '🍦'],
  [/queso/, '🧀'],
  [/jamon|tocino/, '🥓'],
  [/pollo/, '🍗'],
  [/carne|res\b/, '🥩'],
  [/fresa|frutilla|mermelada/, '🍓'],
  [/manzana/, '🍎'],
  [/durazno|melocoton/, '🍑'],
  [/platano|banana/, '🍌'],
  [/limon|lima/, '🍋'],
  [/naranja|mandarina/, '🍊'],
  [/pina|anana/, '🍍'],
  [/cereza|guinda/, '🍒'],
  [/uva|pasa/, '🍇'],
  [/coco/, '🥥'],
  [/nuez|almendra|mani|castana|pecana/, '🥜'],
  [/miel/, '🍯'],
  [/cafe|moca/, '☕'],
  [/\bte\b|mate|manzanilla|hierba/, '🍵'],
  [/tomate/, '🍅'],
  [/cebolla/, '🧅'],
  [/aceituna|aceite|oliva/, '🫒'],
  [/pan\b|levadura|masa|hojaldre/, '🍞'],
  [/gelatina/, '🍮'],
  [/azucar|stevia|endulzante/, '🍬'],
  [/canela|vainilla|clavo|anis|especia/, '🌿'],
  [/sal\b/, '🧂'],
  [/agua|hielo/, '💧']
];

export interface Ingrediente { nombre: string; emoji: string; }

export const listaIngredientes = (texto: string | null | undefined): Ingrediente[] =>
  String(texto || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).slice(0, 15).map(nombre => ({
    nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
    emoji: EMOJI_INGREDIENTE.find(([r]) => r.test(sinTildes(nombre)))?.[1] ?? '✨'
  }));

/** Cada renglón es un paso */
export const pasosPreparacion = (texto: string | null | undefined): string[] =>
  String(texto || '').split('\n').map(t => t.trim()).filter(Boolean).slice(0, 8);

const EMOJI_CATEGORIA: [RegExp, string][] = [
  [/torta|pastel|postre/, '🍰'],
  [/masa.*dulce|dulce|bolleria/, '🥐'],
  [/salad|empanada|sandwich/, '🥟'],
  [/\bte\b|cafe|infusion/, '☕'],
  [/galleta/, '🍪'],
  [/jugo|licuado/, '🧃'],
  [/refresco|gaseosa|bebida/, '🥤'],
  [/agua/, '💧'],
  [/helado/, '🍨'],
  [/pan\b/, '🍞'],
  [/almacen|abarrote/, '🛒']
];

export const emojiCategoria = (nombre: string): string =>
  EMOJI_CATEGORIA.find(([r]) => r.test(sinTildes(nombre)))?.[1] ?? '🍽️';

/** «MASAS SALADAS» → «Masas saladas»; lo que ya tiene minúsculas se respeta */
export const nombreBonito = (nombre: string): string => {
  const t = String(nombre || '').trim();
  if (t !== t.toUpperCase()) return t;
  return t.charAt(0) + t.slice(1).toLowerCase();
};

/** ¡Buenos días! / ¡Buenas tardes! / ¡Buenas noches! según la hora del celular */
export const saludo = (hora = new Date().getHours()): string =>
  hora >= 5 && hora < 12 ? '¡Buenos días!' : hora >= 12 && hora < 19 ? '¡Buenas tardes!' : '¡Buenas noches!';
