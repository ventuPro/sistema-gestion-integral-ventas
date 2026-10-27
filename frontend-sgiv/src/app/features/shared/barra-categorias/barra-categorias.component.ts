import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input, signal, untracked } from '@angular/core';
import { LucideAngularModule, LucideIconData, ChevronDown, LayoutGrid } from 'lucide-angular';

export interface CategoriaBarra { id: number; nombre: string; icono: LucideIconData; cantidad: number }

// ─── Barra de categorías (como en el menú QR) ───
// Queda fija arriba al bajar, muestra la categoría que se está viendo y abre la lista para saltar a otra.
// Cada sección de la página lleva [attr.data-seccion]="id". Se mueve con el contenedor que tenga scroll
// (la página del panel o la lista de un modal); las posiciones se miden solo cuando cambia el contenido.
@Component({
  selector: 'app-barra-categorias',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './barra-categorias.component.html',
  styleUrls: ['./barra-categorias.component.css'],
  host: { '(document:click)': 'alClicFuera($event)', '(document:keydown.escape)': 'abierta.set(false)' }
})
export class BarraCategoriasComponent {
  readonly categorias = input.required<CategoriaBarra[]>();

  readonly icons = { abrir: ChevronDown, todas: LayoutGrid };
  readonly abierta = signal(false);
  readonly actual  = signal<number | null>(null);

  readonly etiqueta = computed(() =>
    this.categorias().find(c => c.id === this.actual()) ?? { id: null, nombre: 'Categorías', icono: LayoutGrid, cantidad: null });

  private host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private contenedor: HTMLElement | null = null;
  private posiciones: { id: number; top: number }[] = [];
  private tamano: ResizeObserver | null = null;
  private readonly sinAnimacion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private readonly alDesplazar = () => {
    const c = this.contenedor;
    if (!c) return;
    // Al llegar al final de la página se marca la última sección que se ve
    const alFinal = c.scrollTop + c.clientHeight >= c.scrollHeight - 2;
    const y = alFinal ? c.scrollTop + c.clientHeight - 40 : c.scrollTop + this.host.offsetHeight + 12;
    let actual: number | null = null;
    for (const p of this.posiciones) { if (p.top > y) break; actual = p.id; }
    if (actual !== this.actual()) this.actual.set(actual);
  };

  constructor() {
    afterNextRender(() => {
      this.contenedor = this.buscarContenedor();
      this.contenedor?.addEventListener('scroll', this.alDesplazar, { passive: true });
      // Fotos que cargan o filtros que cambian el alto: se vuelve a medir
      const contenido = this.host.parentElement;
      if (contenido) {
        this.tamano = new ResizeObserver(() => this.medir());
        this.tamano.observe(contenido);
      }
      this.medir();
    });
    afterRenderEffect(() => { this.categorias(); untracked(() => this.medir()); });
    inject(DestroyRef).onDestroy(() => {
      this.contenedor?.removeEventListener('scroll', this.alDesplazar);
      this.tamano?.disconnect();
    });
  }

  /** El ancestro más cercano con scroll vertical */
  private buscarContenedor(): HTMLElement | null {
    for (let el = this.host.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY;
      if (o === 'auto' || o === 'scroll') return el;
    }
    return document.scrollingElement as HTMLElement;
  }

  private medir() {
    const c = this.contenedor;
    if (!c) return;
    // Pegada al borde visible aunque el contenedor tenga margen interior
    this.host.style.top = `-${parseFloat(getComputedStyle(c).paddingTop) || 0}px`;
    const base = c.getBoundingClientRect().top - c.scrollTop;
    this.posiciones = Array.from(c.querySelectorAll<HTMLElement>('[data-seccion]'), el =>
      ({ id: Number(el.dataset['seccion']), top: el.getBoundingClientRect().top - base }))
      .sort((a, b) => a.top - b.top);
    this.alDesplazar();
  }

  ir(id: number) {
    this.abierta.set(false);
    const c = this.contenedor;
    const destino = this.posiciones.find(p => p.id === id);
    if (!c || !destino) return;
    c.scrollTo({ top: Math.max(0, destino.top - this.host.offsetHeight - 4), behavior: this.sinAnimacion ? 'auto' : 'smooth' });
  }

  alClicFuera(e: Event) {
    if (this.abierta() && !this.host.contains(e.target as Node)) this.abierta.set(false);
  }
}
