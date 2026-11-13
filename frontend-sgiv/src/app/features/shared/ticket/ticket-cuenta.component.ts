import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { Cotizacion } from '../../../core/services/promocion.service';
import { cifra, fechaHora } from '../../../core/utils/informe';
import { ESTILOS_TICKET } from './ticket.estilos';
import { TicketCabeceraComponent } from './ticket-cabecera.component';

/** Línea del carrito o de la mesa (en el mismo orden que la cotización) */
export interface LineaCuenta { nombre_producto: string; cantidad: number; precio_unitario: number }

// ─── Cuenta (precuenta): lo que lleva el cliente, con promociones, antes de cobrar. No registra nada ───
@Component({
  selector: 'app-ticket-cuenta',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [TicketCabeceraComponent],
  styles: [ESTILOS_TICKET],
  template: `
    <div class="tk" [class]="'tk-' + ancho()">
      <app-ticket-cabecera titulo="CUENTA" />

      <hr class="tk-linea">
      <div class="tk-fila"><span>Fecha</span><span>{{ fecha }}</span></div>
      @if (mesa()) { <div class="tk-fila"><span>Mesa</span><span>{{ mesa() }}</span></div> }
      <hr class="tk-linea">

      @for (l of filas(); track $index) {
        <div class="tk-item">
          <div>{{ l.nombre_producto }}</div>
          <div class="tk-fila tk-detalle">
            <span>{{ l.cantidad }} x {{ cifra(l.precio_unitario) }}</span><span>{{ cifra(l.bruto) }}</span>
          </div>
          @if (l.descuento) {
            <div class="tk-fila tk-detalle"><span>{{ l.promocion || 'Promoción' }}</span><span>-{{ cifra(l.descuento) }}</span></div>
          }
        </div>
      }

      <hr class="tk-linea">
      @if (ahorro()) {
        <div class="tk-fila"><span>Subtotal</span><span>{{ cifra(bruto()) }}</span></div>
        @if (cotizacion()?.descuento_promociones) {
          <div class="tk-fila"><span>Promociones</span><span>-{{ cifra(cotizacion()!.descuento_promociones) }}</span></div>
        }
        @if (cotizacion()?.descuento_manual) {
          <div class="tk-fila"><span>Descuento</span><span>-{{ cifra(cotizacion()!.descuento_manual) }}</span></div>
        }
      }
      <div class="tk-fila tk-total"><span>TOTAL {{ ajustes.config().moneda_simbolo }}</span><span>{{ cifra(total()) }}</span></div>

      @if (porCliente().length > 1) {
        <hr class="tk-linea">
        @for (g of porCliente(); track $index) {
          <div class="tk-fila"><span>{{ g.nombre }}</span><span>{{ cifra(g.total) }}</span></div>
        }
      }

      <p class="tk-pie">No válido como comprobante de pago</p>
    </div>
  `
})
export class TicketCuentaComponent {
  readonly ajustes = inject(AjustesService);
  readonly cifra = cifra;
  readonly fecha = fechaHora(new Date().toISOString());

  readonly lineas     = input.required<LineaCuenta[]>();
  /** null mientras se calcula: se muestra a precio de lista */
  readonly cotizacion = input<Cotizacion | null>(null);
  readonly mesa       = input<number | null>(null);
  /** Mesas con varios clientes: lo de cada uno */
  readonly porCliente = input<{ nombre: string; total: number }[]>([]);

  readonly ancho = computed(() => this.ajustes.config().ticket_ancho || '80');

  readonly filas = computed(() => {
    const cot = this.cotizacion()?.items || [];
    return this.lineas().map((l, i) => {
      const c = cot[i];
      return {
        ...l, bruto: Number(l.precio_unitario) * Number(l.cantidad),
        descuento: c ? Number(c.descuento_promocion) || 0 : 0, promocion: c?.promociones?.[0] || ''
      };
    });
  });

  readonly bruto = computed(() => this.filas().reduce((s, l) => s + l.bruto, 0));
  readonly total = computed(() => this.cotizacion()?.total ?? this.bruto());
  readonly ahorro = computed(() => (this.cotizacion()?.descuento_promociones || 0) + (this.cotizacion()?.descuento_manual || 0));
}
