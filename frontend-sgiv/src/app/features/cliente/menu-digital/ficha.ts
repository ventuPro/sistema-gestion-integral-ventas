// ─── Ficha del producto en el menú QR: ingredientes, preparación y categorías ───
import {
  Apple, Banana, Beef, CakeSlice, Candy, Cherry, Citrus, Coffee, Cookie, Croissant, CupSoda, Dessert,
  Droplet, Drumstick, Egg, GlassWater, Grape, Ham, IceCreamCone, Leaf, LucideIconData, Milk, Nut,
  Sandwich, ShoppingBasket, Sparkle, UtensilsCrossed, Wheat
} from 'lucide-angular';

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// El primero que coincide gana (por eso «dulce de leche» va antes que «leche»)
const ICONO_INGREDIENTE: [RegExp, LucideIconData][] = [
  [/dulce de leche|manjar|caramelo|flan|gelatina/, Dessert],
  [/chocolate|cacao|nutella|azucar|stevia|endulzante|miel/, Candy],
  [/oreo|galleta/, Cookie],
  [/huevo|yema|clara/, Egg],
  [/leche|yogur|crema|nata|chantilly|mantequilla|margarina/, Milk],
  [/harina|trigo|avena|integral|maicena|maiz|pan\b|levadura|masa|hojaldre/, Wheat],
  [/merengue|helado/, IceCreamCone],
  [/jamon|tocino|queso/, Ham],
  [/pollo/, Drumstick],
  [/carne|res\b/, Beef],
  [/fresa|frutilla|cereza|guinda|mermelada/, Cherry],
  [/manzana|durazno|melocoton|pina|anana/, Apple],
  [/platano|banana/, Banana],
  [/limon|lima|naranja|mandarina/, Citrus],
  [/uva|pasa/, Grape],
  [/nuez|almendra|mani|castana|pecana|coco/, Nut],
  [/cafe|moca/, Coffee],
  [/\bte\b|mate|manzanilla|hierba|canela|vainilla|clavo|anis|especia|tomate|cebolla|aceituna|oliva/, Leaf],
  [/agua|hielo/, Droplet]
];

export interface Ingrediente { nombre: string; icono: LucideIconData; }

export const listaIngredientes = (texto: string | null | undefined): Ingrediente[] =>
  String(texto || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).slice(0, 15).map(nombre => ({
    nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
    icono: ICONO_INGREDIENTE.find(([r]) => r.test(sinTildes(nombre)))?.[1] ?? Sparkle
  }));

/** Cada renglón es un paso */
export const pasosPreparacion = (texto: string | null | undefined): string[] =>
  String(texto || '').split('\n').map(t => t.trim()).filter(Boolean).slice(0, 8);

const ICONO_CATEGORIA: [RegExp, LucideIconData][] = [
  [/torta|pastel|postre/, CakeSlice],
  [/masa.*dulce|dulce|bolleria|pan\b/, Croissant],
  [/salad|empanada|sandwich/, Sandwich],
  [/\bte\b|cafe|infusion/, Coffee],
  [/galleta/, Cookie],
  [/jugo|licuado|refresco|gaseosa|bebida/, CupSoda],
  [/agua/, GlassWater],
  [/helado/, IceCreamCone],
  [/almacen|abarrote/, ShoppingBasket]
];

export const iconoCategoria = (nombre: string): LucideIconData =>
  ICONO_CATEGORIA.find(([r]) => r.test(sinTildes(nombre)))?.[1] ?? UtensilsCrossed;

/** «MASAS SALADAS» → «Masas saladas»; lo que ya tiene minúsculas se respeta */
export const nombreBonito = (nombre: string): string => {
  const t = String(nombre || '').trim();
  if (t !== t.toUpperCase()) return t;
  return t.charAt(0) + t.slice(1).toLowerCase();
};

/** ¡Buenos días! / ¡Buenas tardes! / ¡Buenas noches! según la hora del celular */
export const saludo = (hora = new Date().getHours()): string =>
  hora >= 5 && hora < 12 ? '¡Buenos días!' : hora >= 12 && hora < 19 ? '¡Buenas tardes!' : '¡Buenas noches!';
