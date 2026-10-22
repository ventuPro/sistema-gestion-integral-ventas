import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { LucideAngularModule, Plus, Star } from 'lucide-angular';
import { iconoCategoria, nombreBonito } from './ficha';

// ─── Carrusel «Recomendados de la casa» (bienvenida y menú) ───
// Avanza solo cada pocos segundos; se detiene un rato si el cliente lo toca.
@Component({
  selector:    'app-carrusel-recomendados',
  standalone:  true,
  imports:     [ImagenUrlPipe, LucideAngularModule],
  templateUrl: './carrusel-recomendados.component.html',
  styleUrls:   ['./carrusel-recomendados.component.css']
})
export class CarruselRecomendadosComponent {
  readonly productos   = input.required<any[]>();
  readonly moneda      = input('Bs.');
  readonly variante    = input<'menu' | 'bienvenida'>('menu');
  readonly cantidades  = input<Record<number, number>>({});
  readonly puedePedir  = input(true);
  readonly agregar     = output<any>();
  readonly ver         = output<any>();

  readonly icons = { mas: Plus, estrella: Star };
  readonly Number = Number;
  readonly iconoCategoria = iconoCategoria;
  readonly nombreBonito = nombreBonito;

  private readonly pista = viewChild<ElementRef<HTMLElement>>('pista');
  readonly indice = signal(0);
  private pausadoHasta = 0;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const id = setInterval(() => this.avanzar(), 4500);
      destroy.onDestroy(() => clearInterval(id));
    });
  }

  precio(p: any): number {
    const promo = p.promocion?.precio_promocional;
    return Number(promo ?? p.precio_unitario);
  }

  /** Un toque del cliente detiene el avance automático unos segundos */
  pausar() { this.pausadoHasta = Date.now() + 8000; }

  alDesplazar() {
    const el = this.pista()?.nativeElement;
    const primera = el?.firstElementChild as HTMLElement | null;
    if (!el || !primera) return;
    this.indice.set(Math.round(el.scrollLeft / (primera.offsetWidth + 12)));
  }

  irA(i: number) {
    const el = this.pista()?.nativeElement;
    const tarjeta = el?.children[i] as HTMLElement | undefined;
    if (el && tarjeta) el.scrollTo({ left: tarjeta.offsetLeft - 16, behavior: 'smooth' });
  }

  private avanzar() {
    const n = this.productos().length;
    if (n < 2 || document.hidden || Date.now() < this.pausadoHasta) return;
    this.irA((this.indice() + 1) % n);
  }
}
