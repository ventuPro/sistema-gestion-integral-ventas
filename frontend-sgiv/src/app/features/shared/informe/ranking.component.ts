import { Component, computed, input } from '@angular/core';

export interface FilaRanking { nombre: string; valor: number; color?: string; detalle?: string; sub?: string }

// ─── Ranking: una barra por fila con el monto escrito al final (no hay que leer un eje) ───
@Component({
  selector: 'app-ranking',
  standalone: true,
  template: `
    @if (filas().length) {
      <ol class="ranking">
        @for (f of filas(); track f.nombre; let i = $index) {
          <li>
            <span class="nombre">
              <span class="puesto">{{ i + 1 }}</span>
              <span class="texto">{{ f.nombre }}@if (f.sub) { <small>{{ f.sub }}</small> }</span>
            </span>
            <span class="pista">
              <span class="barra" [style.width]="'calc((100% - 96px) * ' + (f.valor / maximo()) + ')'" [style.background]="f.color || color()"></span>
              <span class="monto">{{ formato()(f.valor) }}@if (f.detalle) { <small>{{ f.detalle }}</small> }</span>
            </span>
          </li>
        }
      </ol>
    } @else {
      <p class="vacio">{{ vacio() }}</p>
    }
  `,
  styles: [`
    .vacio { margin: 0; padding: 18px 0; text-align: center; color: var(--i-tenue); font-size: calc(13px * var(--escala-texto)); }
    .ranking { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
    .ranking li { display: grid; grid-template-columns: minmax(120px, 210px) minmax(0, 1fr); gap: 12px; align-items: center;
                  font-size: calc(12.5px * var(--escala-texto)); }
    .nombre { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
    .puesto { color: var(--i-sutil); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 1.4em; text-align: right; }
    .texto { color: var(--i-tinta); font-weight: 600; overflow-wrap: anywhere; }
    .texto small, .monto small { display: block; color: var(--i-tenue); font-weight: 500; font-size: calc(11px * var(--escala-texto)); }
    .pista { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .barra { height: 16px; border-radius: 0 4px 4px 0; flex-shrink: 0; min-width: 2px; }
    .monto { color: var(--i-tinta); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
    @media (max-width: 480px) { .ranking li { grid-template-columns: 1fr; gap: 4px; } }
  `]
})
export class RankingComponent {
  readonly filas   = input.required<FilaRanking[]>();
  readonly formato = input<(v: number) => string>((v) => String(v));
  readonly color   = input('var(--i-acento)');
  readonly vacio   = input('Sin datos.');
  readonly maximo  = computed(() => Math.max(1, ...this.filas().map(f => f.valor)));
}
