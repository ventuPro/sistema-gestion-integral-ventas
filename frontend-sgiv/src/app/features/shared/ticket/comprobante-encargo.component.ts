import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { Encargo } from '../../../core/services/encargo.service';
import { fechaDia, fechaHora } from '../../../core/utils/informe';
import { ESTILOS_TICKET } from './ticket.estilos';
import { TicketCabeceraComponent } from './ticket-cabecera.component';

// ─── Encargo: un solo ticket que sirve de comprobante para el cliente y de orden de producción ───
@Component({
  selector: 'app-comprobante-encargo',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [TicketCabeceraComponent],
  styles: [ESTILOS_TICKET],
  template: `
    <div class="tk" [class]="'tk-' + ancho()">
      <app-ticket-cabecera titulo="ENCARGO" />

      <hr class="tk-linea">
      <div class="tk-fila"><span>Encargo</span><span>#{{ e().id_encargo }}</span></div>
      <div class="tk-fila"><span>Registrado</span><span>{{ registrado() }}</span></div>
      <div class="tk-fila"><span>Sucursal</span><span>{{ e().nombre_sucursal }}</span></div>
      @if (e().registrado_por) { <div class="tk-fila"><span>Atendido por</span><span>{{ e().registrado_por }}</span></div> }
      <hr class="tk-linea">
      <div class="tk-fila"><span>Cliente</span><span>{{ e().nombre_cliente }}</span></div>
      <div class="tk-fila"><span>Celular</span><span>{{ e().celular_cliente }}</span></div>
      <div class="tk-fila"><span>Evento</span><span>{{ e().tipo_evento }}</span></div>
      <hr class="tk-linea">
      <div class="tk-fila tk-total"><span>ENTREGA</span><span>{{ entrega() }}</span></div>
      <div class="tk-fila"><span>Hora</span><span>{{ e().hora }}</span></div>
      @if (e().a_domicilio) {
        <p class="tk-dato">A domicilio: {{ e().direccion_entrega }}</p>
      } @else {
        <div class="tk-fila"><span>Retira en</span><span>{{ e().nombre_sucursal }}</span></div>
      }
      <hr class="tk-linea">

      @for (i of e().items; track $index) {
        <div class="tk-fila tk-item"><span>{{ i.cantidad }} x {{ i.descripcion }}</span><span>{{ m(i.subtotal) }}</span></div>
        @if (i.detalle) { <p class="tk-detalle">{{ i.detalle }}</p> }
      }

      <hr class="tk-linea">
      <div class="tk-fila tk-total"><span>TOTAL</span><span>{{ moneda() }} {{ m(e().total) }}</span></div>
      @if (e().estado === 'Entregado') {
        <div class="tk-fila"><span>Pago</span><span>Cobrado</span></div>
      } @else if (Number(e().adelanto) > 0) {
        <div class="tk-fila"><span>Adelanto</span><span>{{ moneda() }} {{ m(e().adelanto) }}</span></div>
        <div class="tk-fila"><span>{{ e().saldo ? 'Saldo al entregar' : 'Pago' }}</span>
          <span>{{ e().saldo ? moneda() + ' ' + m(e().saldo) : 'Pagado todo' }}</span></div>
      } @else {
        <div class="tk-fila"><span>Pago</span><span>Al entregar</span></div>
      }
      @if (e().observaciones) { <p class="tk-dato">Obs.: {{ e().observaciones }}</p> }

      <p class="tk-pie">{{ ajustes.config().ticket_mensaje_pie }}</p>
    </div>
  `
})
export class ComprobanteEncargoComponent {
  readonly ajustes = inject(AjustesService);
  readonly moneda = this.ajustes.moneda;
  readonly e = input.required<Encargo>();
  readonly Number = Number;

  readonly ancho      = computed(() => this.ajustes.config().ticket_ancho || '80');
  readonly registrado = computed(() => this.e().fecha_registro ? fechaHora(this.e().fecha_registro!) : '');
  readonly entrega    = computed(() => fechaDia(this.e().fecha));

  m(n: any) { return (Number(n) || 0).toFixed(2); }
}
