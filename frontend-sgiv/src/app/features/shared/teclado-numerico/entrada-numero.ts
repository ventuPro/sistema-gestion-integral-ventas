import { computed, Signal, signal, WritableSignal } from '@angular/core';

/** Lo que edita el tablero: el texto que muestra y qué hacer con cada tecla */
export interface EntradaNumero {
  readonly mostrado: Signal<string>;
  readonly decimales: boolean;
  tecla(tecla: string): void;
  sumar?(monto: number): void;
}

/**
 * Aplica una tecla (dígito, '.', 'borrar', 'limpiar') al texto.
 * reemplazar: la primera cifra empieza de cero (como al tocar una línea en Odoo).
 */
export function aplicarTecla(texto: string, tecla: string, { decimales = true, reemplazar = false } = {}): string {
  if (tecla === 'limpiar') return '';
  if (tecla === 'borrar') return texto.slice(0, -1);
  let t = reemplazar ? '' : texto;
  if (tecla === '.') return !decimales || t.includes('.') ? t : (t || '0') + '.';
  if (!/^\d$/.test(tecla)) return t;
  if (t.includes('.') && t.split('.')[1].length >= 2) return t;
  if (t.replace('.', '').length >= 7) return t;
  if (t === '0') t = '';
  return t + tecla;
}

/** Monto con decimales guardado en una señal (fondo inicial, monto recibido, efectivo contado) */
export class EntradaMonto implements EntradaNumero {
  readonly decimales = true;
  // Texto escrito con el tablero ('12.' todavía no es un número); vale mientras la señal no cambie por otro lado
  private readonly escrito = signal<{ texto: string; valor: number | null } | null>(null);
  readonly mostrado = computed(() => {
    const e = this.escrito(), v = this.valor();
    return e && e.valor === v ? e.texto : (v == null ? '' : String(v));
  });

  constructor(private readonly valor: WritableSignal<number | null>) {}

  tecla(tecla: string) {
    const texto = aplicarTecla(this.mostrado(), tecla);
    const valor = texto === '' ? null : Number(texto);
    this.escrito.set({ texto, valor });
    this.valor.set(valor);
  }

  /** Billetes rápidos: suman al monto */
  sumar(monto: number) {
    this.valor.set(Math.round(((Number(this.valor()) || 0) + monto) * 100) / 100);
  }
}
