import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { ESTILOS_TICKET } from './ticket.estilos';
import { TicketCabeceraComponent } from './ticket-cabecera.component';

export interface GrupoListaDia { categoria: string; items: { nombre_producto: string; cantidad: number; detalle?: string }[] }

// ─── Lista de productos por categoría (Ingresos del día, Inventario): mismo formato que los comprobantes ───
@Component({
  selector: 'app-ticket-lista-dia',
  standalone: true,
  imports: [TicketCabeceraComponent],
  encapsulation: ViewEncapsulation.None,
  styles: [ESTILOS_TICKET],
  template: `
    <div class="tk" [class]="'tk-' + ancho()">
      <app-ticket-cabecera [titulo]="titulo()" />

      <hr class="tk-linea">
      @if (sucursal()) { <div class="tk-fila"><span>Sucursal</span><span>{{ sucursal() }}</span></div> }
      <div class="tk-fila"><span>Fecha</span><span>{{ fecha() }}</span></div>
      <hr class="tk-linea">

      <div class="tk-fila"><span><b>Producto</b></span><span><b>Cant.</b></span></div>
      @for (g of grupos(); track g.categoria; let primero = $first) {
        @if (!primero) { <hr class="tk-linea"> }
        <p class="tk-grupo">{{ g.categoria }}</p>
        @for (i of g.items; track $index) {
          <div class="tk-fila tk-item"><span>{{ i.nombre_producto }}</span><span>{{ i.cantidad }}</span></div>
          @if (i.detalle) { <p class="tk-detalle">{{ i.detalle }}</p> }
        }
      }

      <hr class="tk-linea">
      <div class="tk-fila"><span>Productos</span><span>{{ productos() }}</span></div>
      <div class="tk-fila tk-total"><span>UNIDADES</span><span>{{ unidades() }}</span></div>
    </div>
  `
})
export class TicketListaDiaComponent {
  readonly ajustes = inject(AjustesService);
  readonly grupos   = input.required<GrupoListaDia[]>();
  readonly sucursal = input('');
  /** Ya formateada (dd/mm/aaaa o dd/mm/aaaa hh:mm) */
  readonly fecha    = input('');
  readonly titulo   = input('');

  readonly ancho     = computed(() => this.ajustes.config().ticket_ancho || '80');
  readonly productos = computed(() => this.grupos().reduce((s, g) => s + g.items.length, 0));
  readonly unidades  = computed(() => this.grupos().reduce((s, g) => s + g.items.reduce((t, i) => t + i.cantidad, 0), 0));
}
