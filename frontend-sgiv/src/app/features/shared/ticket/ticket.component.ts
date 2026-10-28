import { Component, ElementRef, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { cifra, fechaHora } from '../../../core/utils/informe';
import { ESTILOS_TICKET } from './ticket.estilos';
import { METODO_PAGO } from '../../../core/utils/metodos-pago';

export interface DatosTicket {
  id_venta: number;
  /** subtotal = cantidad × precio de lista; descuento = ahorro por promoción en esa línea */
  items: { nombre_producto: string; cantidad: number; precio_unitario?: number; subtotal: number; descuento?: number; promocion?: string }[];
  total: number;
  descuento_promociones?: number;
  descuento_manual?: number;
  motivo_descuento?: string | null;
  metodo: string;
  cambio?: number;
  numero_mesa?: number;
  /** Cobro por separado: a nombre de quién */
  cliente?: string;
  /** Copia impresa después: fecha y hora de la reimpresión */
  reimpreso?: Date;
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
  readonly metodo = METODO_PAGO;

  get textoFecha(): string { return fechaHora(this.fecha().toISOString()); }
  get textoReimpreso(): string { const r = this.datos().reimpreso; return r ? fechaHora(r.toISOString()) : ''; }

  readonly ahorro = computed(() => (this.datos().descuento_promociones || 0) + (this.datos().descuento_manual || 0));
  readonly subtotal = computed(() => this.datos().items.reduce((s, i) => s + i.subtotal, 0));
}
