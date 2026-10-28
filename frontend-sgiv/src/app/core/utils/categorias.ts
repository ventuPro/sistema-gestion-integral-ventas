import { LucideIconData } from 'lucide-angular';
import { iconoCategoria, nombreBonito } from '../../features/cliente/menu-digital/ficha';

// ─── Productos agrupados por categoría (mismo orden que el menú QR) ───

export interface Seccion<T> { id: number; nombre: string; icono: LucideIconData; productos: T[] }

interface ConCategoria { id_categoria: any; nombre_categoria: string; stock_actual?: any }

/**
 * Los productos deben llegar ordenados por categoría (el backend usa categoria_producto.orden).
 * stockPrimero: dentro de cada categoría van primero los que tienen stock y al final los agotados.
 */
export function agruparPorCategoria<T extends ConCategoria>(lista: T[], { stockPrimero = true } = {}): Seccion<T>[] {
  const mapa = new Map<number, Seccion<T>>();
  for (const p of lista) {
    const id = Number(p.id_categoria);
    let s = mapa.get(id);
    if (!s) {
      s = { id, nombre: nombreBonito(p.nombre_categoria || ''), icono: iconoCategoria(p.nombre_categoria || ''), productos: [] };
      mapa.set(id, s);
    }
    s.productos.push(p);
  }
  const secciones = [...mapa.values()];
  if (stockPrimero) {
    const conStock = (p: T) => (Number(p.stock_actual) > 0 ? 0 : 1);
    for (const s of secciones) s.productos = [...s.productos].sort((a, b) => conStock(a) - conStock(b));
  }
  return secciones;
}

/**
 * Producto que se agrega con Enter al buscar: el primero con stock (en el orden de la lista)
 * cuyo nombre empieza con el texto; si no, una de sus palabras; si no, cualquiera que lo contenga.
 */
export function mejorCoincidencia<T extends ConCategoria & { nombre_producto?: string }>(secciones: Seccion<T>[], texto: string): T | null {
  const q = texto.trim().toLowerCase();
  if (!q) return null;
  const disponibles = secciones.flatMap(s => s.productos).filter(p => Number(p.stock_actual) > 0);
  const nombre = (p: T) => (p.nombre_producto || '').toLowerCase();
  return disponibles.find(p => nombre(p).startsWith(q))
      ?? disponibles.find(p => nombre(p).split(/\s+/).some(w => w.startsWith(q)))
      ?? disponibles[0] ?? null;
}
