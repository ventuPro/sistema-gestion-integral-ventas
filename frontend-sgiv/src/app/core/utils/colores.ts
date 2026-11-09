import { METODO_PAGO } from './metodos-pago';

// ─── Colores de los gráficos (iguales en el Panel, los Reportes y el kardex) ───
// C1: el color de la marca (Ajustes → Apariencia) lo da temaGrafico().
// C2: colores con significado. C3: uno por método de pago. C4: uno fijo por categoría.
// La paleta de categorías está revisada para que se distinga también con daltonismo y en
// modo oscuro (en este orden): no se reordena ni se agregan colores; desde la 9.ª, gris.

const CATEGORIAS_CLARO  = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const CATEGORIAS_OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const GRIS = { claro: '#94a3b8', oscuro: '#64748b' };

/** Color de la categoría según su lugar en el orden del menú (0 = primera) */
export function colorCategoria(indice: number, oscuro: boolean): string {
  const paleta = oscuro ? CATEGORIAS_OSCURO : CATEGORIAS_CLARO;
  return indice >= 0 && indice < paleta.length ? paleta[indice] : (oscuro ? GRIS.oscuro : GRIS.claro);
}

/** id_categoria → lugar en el orden del menú (la lista de categorías ya llega ordenada) */
export function indiceCategorias(categorias: { id_categoria: number }[]): Map<number, number> {
  return new Map(categorias.map((c, i) => [Number(c.id_categoria), i]));
}

export function colorMetodo(metodo: string, oscuro: boolean): string {
  if (metodo === METODO_PAGO.efectivo) return oscuro ? '#199e70' : '#1baf7a';
  if (metodo === METODO_PAGO.qr) return oscuro ? '#3987e5' : '#2a78d6';
  return oscuro ? GRIS.oscuro : GRIS.claro;
}

/** C2: ingresos y ganancia, salidas y pérdidas, costos y avisos, saldo */
export function coloresSignificado(oscuro: boolean) {
  return oscuro
    ? { ingreso: '#0ca30c', salida: '#f87171', costo: '#fbbf24', saldo: '#3987e5', gris: GRIS.oscuro }
    : { ingreso: '#0ca30c', salida: '#d03b3b', costo: '#b45309', saldo: '#2a78d6', gris: GRIS.claro };
}
