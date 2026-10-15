import { Component, ElementRef, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { cifra, fechaHora } from '../../../core/utils/informe';
import { ESTILOS_TICKET } from './ticket.estilos';

export interface DatosTicket {
  id_venta: number;
  items: { nombre_producto: string; cantidad: number; precio_unitario?: number; subtotal: number }[];
  total: number;
  metodo: string;
  cambio?: number;
  numero_mesa?: number;
  /** Cobro por separado: a nombre de quién */
  cliente?: string;
}

// ─── Comprobante de venta (Punto de venta y Mesas) ───
@Component({
  selector: 'app-ticket',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styles: [ESTILOS_TICKET],
  templateUrl: './ticket.component.html'
})
export class TicketComponent {
  readonly ajustes = inject(AjustesService);
  readonly elemento = inject(ElementRef<HTMLElement>);

  readonly datos = input.required<DatosTicket>();
  readonly fecha = input<Date>(new Date());

  readonly c = this.ajustes.config;
  readonly ancho = computed(() => this.c().ticket_ancho || '80');
  readonly cifra = cifra;

  get textoFecha(): string { return fechaHora(this.fecha().toISOString()); }
}
