import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { ESTILOS_TICKET } from './ticket.estilos';

export interface GrupoListaDia { categoria: string; items: { nombre_producto: string; cantidad: number }[] }

// ─── Lista de productos que quedaron del día anterior (impresora de tickets) ───
@Component({
  selector: 'app-ticket-lista-dia',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styles: [ESTILOS_TICKET],
  template: `
    <div class="tk" [class]="'tk-' + ancho()">
      <div class="tk-cabecera">
        <p class="tk-nombre">{{ ajustes.nombre() }}</p>
        <p class="tk-dato">{{ titulo() }}</p>
        <p class="tk-dato">{{ sucursal() }} · {{ fecha() }}</p>
      </div>
      @for (g of grupos(); track g.categoria) {
        <hr class="tk-linea">
        <p class="tk-dato"><b>{{ g.categoria }}</b></p>
        @for (i of g.items; track i.nombre_producto) {
          <div class="tk-fila"><span>{{ i.nombre_producto }}</span><span>{{ i.cantidad }}</span></div>
        }
      }
      <hr class="tk-linea">
      <div class="tk-fila tk-total"><span>UNIDADES</span><span>{{ unidades() }}</span></div>
    </div>
  `
})
export class TicketListaDiaComponent {
  readonly ajustes = inject(AjustesService);
  readonly grupos   = input.required<GrupoListaDia[]>();
  readonly sucursal = input('');
  readonly fecha    = input('');
  readonly titulo   = input('PRODUCTOS QUE QUEDARON');

  readonly ancho    = computed(() => this.ajustes.config().ticket_ancho || '80');
  readonly unidades = computed(() => this.grupos().reduce((s, g) => s + g.items.reduce((t, i) => t + i.cantidad, 0), 0));
}
