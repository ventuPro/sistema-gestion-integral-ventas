import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { LucideAngularModule, LucideIconData, X, ArrowRight, Gift } from 'lucide-angular';

// ─── Panel inferior del menú QR: categorías o promociones de hoy ───
// Mientras está abierto la página de atrás no se mueve; se cierra también arrastrándolo hacia abajo.
@Component({
  selector:    'app-panel-menu',
  standalone:  true,
  imports:     [LucideAngularModule],
  templateUrl: './panel-menu.component.html',
  styleUrls:   ['./panel-menu.component.css']
})
export class PanelMenuComponent {
  readonly tipo              = input.required<'categorias' | 'promos'>();
  readonly categorias        = input<{ id: number; nombre: string; icono: LucideIconData; cantidad: number }[]>([]);
  readonly seccionActual     = input<number | null>(null);
  readonly promociones       = input<{ nombre: string; texto: string }[]>([]);
  readonly productosPorPromo = input<Record<string, number>>({});
  readonly cerrar            = output<void>();
  readonly categoria         = output<number>();
  readonly promo             = output<string>();

  readonly icons = { cerrar: X, ver: ArrowRight, promo: Gift };
  readonly saliendo = signal(false);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly sinAnimacion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    // El espacio de la barra de desplazamiento se conserva para que en la PC nada se corra
    const html = document.documentElement.style, antes = [html.overflow, html.scrollbarGutter];
    html.scrollbarGutter = 'stable';
    html.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => [html.overflow, html.scrollbarGutter] = antes);
    afterNextRender(() => this.permitirArrastre());
  }

  /** Cierra con la animación de bajada y luego avisa (elegir categoría, promo o cerrar) */
  salir(accion: () => void = () => this.cerrar.emit()) {
    if (this.saliendo()) return;
    if (this.sinAnimacion) return accion();
    this.saliendo.set(true);
    const el = this.panel().nativeElement;
    el.style.transition = 'transform 200ms ease-in';
    el.style.transform = 'translateY(100%)';
    setTimeout(accion, 190);
  }

  private permitirArrastre() {
    const el = this.panel().nativeElement;
    let inicio = 0, dy = 0, arrastrando = false, momento = 0;

    el.addEventListener('touchstart', e => {
      // Solo si la lista está arriba del todo (si no, el dedo desplaza la lista)
      arrastrando = el.scrollTop <= 0;
      inicio = e.touches[0].clientY; dy = 0; momento = Date.now();
      el.style.transition = 'none';
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (!arrastrando) return;
      dy = e.touches[0].clientY - inicio;
      if (dy <= 0) { el.style.transform = ''; return; }
      e.preventDefault();
      el.style.transform = `translateY(${dy}px)`;
    }, { passive: false });

    el.addEventListener('touchend', () => {
      if (!arrastrando || dy <= 0) return;
      arrastrando = false;
      const rapido = dy / Math.max(1, Date.now() - momento) > 0.6;
      if (dy > el.offsetHeight * 0.25 || rapido) return this.salir();
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = '';
    });
  }
}
