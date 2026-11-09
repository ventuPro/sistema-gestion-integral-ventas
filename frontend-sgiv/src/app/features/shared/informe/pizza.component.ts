import { Component, ElementRef, OnDestroy, ViewChild, afterNextRender, computed, effect, inject, input, untracked, Injector } from '@angular/core';
import { Chart } from '../../../core/utils/graficos';
import { AjustesService } from '../../../core/services/ajustes.service';
import { temaGrafico } from '../../../core/utils/informe';

export interface ParteGrafico { nombre: string; valor: number; color: string }

// ─── Pizza con su lista al lado: color, nombre, porcentaje y monto (no hay que adivinar en el dibujo) ───
@Component({
  selector: 'app-pizza',
  standalone: true,
  template: `
    @if (partes().length) {
      <div class="pizza">
        <div class="lienzo" [style.height.px]="alto()"><canvas #lienzo role="img" [attr.aria-label]="titulo()"></canvas></div>
        <ul class="lista">
          @for (p of conPorcentaje(); track p.nombre) {
            <li>
              <span class="color" [style.background]="p.color"></span>
              <span class="nombre">{{ p.nombre }}</span>
              <span class="cifras"><b>{{ p.porcentaje }} %</b> · {{ formato()(p.valor) }}</span>
            </li>
          }
        </ul>
      </div>
    } @else {
      <p class="vacio">{{ vacio() }}</p>
    }
  `,
  styles: [`
    .vacio { margin: 0; padding: 18px 0; text-align: center; color: var(--i-tenue); font-size: calc(13px * var(--escala-texto)); }
    .pizza { display: grid; grid-template-columns: minmax(140px, 190px) minmax(0, 1fr); gap: 18px; align-items: center; }
    @media (max-width: 560px) { .pizza { grid-template-columns: 1fr; } }
    .lienzo { position: relative; }
    .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .lista li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 9px; align-items: center;
                font-size: calc(12.5px * var(--escala-texto)); }
    .color { width: 12px; height: 12px; border-radius: 3px; }
    .nombre { color: var(--i-tinta); font-weight: 600; overflow-wrap: anywhere; }
    .cifras { color: var(--i-tenue); white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
    .cifras b { color: var(--i-tinta); font-size: calc(13.5px * var(--escala-texto)); }
  `]
})
export class PizzaComponent implements OnDestroy {
  private ajustes  = inject(AjustesService);
  private injector = inject(Injector);
  private host     = inject(ElementRef<HTMLElement>);

  readonly partes  = input.required<ParteGrafico[]>();
  readonly formato = input<(v: number) => string>((v) => String(v));
  readonly titulo  = input('');
  readonly alto    = input(190);
  readonly vacio   = input('Sin datos.');

  @ViewChild('lienzo') lienzo?: ElementRef<HTMLCanvasElement>;
  private grafico?: Chart;

  readonly total = computed(() => this.partes().reduce((s, p) => s + p.valor, 0));
  readonly conPorcentaje = computed(() => {
    const t = this.total() || 1;
    return this.partes().map(p => ({ ...p, porcentaje: Math.round(p.valor * 100 / t) }));
  });

  constructor() {
    effect(() => {
      this.partes(); this.ajustes.oscuro(); this.ajustes.config();
      untracked(() => afterNextRender(() => this.dibujar(), { injector: this.injector }));
    });
  }

  ngOnDestroy() { this.grafico?.destroy(); }

  private dibujar() {
    this.grafico?.destroy();
    this.grafico = undefined;
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo || !this.partes().length) return;
    const t = temaGrafico(this.ajustes);
    // El borde entre porciones toma el color del fondo (separa las porciones en ambos temas)
    const fondo = getComputedStyle(this.host.nativeElement).getPropertyValue('--i-papel').trim() || '#ffffff';
    const total = this.total() || 1;
    this.grafico = new Chart(lienzo, {
      type: 'pie',
      data: {
        labels: this.partes().map(p => p.nombre),
        datasets: [{ data: this.partes().map(p => p.valor), backgroundColor: this.partes().map(p => p.color),
                     borderColor: fondo, borderWidth: 2, hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: 6 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: t.fondoTooltip, padding: 9, cornerRadius: 6,
            titleColor: t.fondoTooltip === '#0f172a' ? '#f8fafc' : '#0f172a',
            bodyColor: t.fondoTooltip === '#0f172a' ? '#e2e8f0' : '#1e293b',
            callbacks: { label: (c: any) => ` ${this.formato()(c.parsed)} (${Math.round(c.parsed * 100 / total)} %)` }
          }
        }
      } as any
    });
  }
}
