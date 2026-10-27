import { Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';
import { Transferencia } from '../../../core/services/inventario.service';
import { fechaHora } from '../../../core/utils/informe';
import { ESTILOS_TICKET } from './ticket.estilos';

// ─── Comprobante de transferencia: viaja con la mercadería (se imprime con ImpresionService) ───
@Component({
  selector: 'app-comprobante-transferencia',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styles: [ESTILOS_TICKET],
  template: `
    <div class="tk" [class]="'tk-' + ancho()">
      <div class="tk-cabecera">
        @if (ajustes.logo()) { <img class="tk-logo" [src]="ajustes.logo()" alt=""> }
        <p class="tk-nombre">{{ ajustes.nombre() }}</p>
        <p class="tk-dato">TRANSFERENCIA DE PRODUCTOS</p>
      </div>

      <hr class="tk-linea">
      <div class="tk-fila"><span>Transferencia</span><span>#{{ t().id_transferencia }}</span></div>
      <div class="tk-fila"><span>Fecha</span><span>{{ fecha() }}</span></div>
      <div class="tk-fila"><span>Desde</span><span>{{ t().nombre_origen }}</span></div>
      <div class="tk-fila"><span>Hacia</span><span>{{ t().nombre_destino }}</span></div>
      @if (t().usuario) { <div class="tk-fila"><span>Enviado por</span><span>{{ t().usuario }}</span></div> }
      <hr class="tk-linea">

      @for (item of t().items || []; track item.id_producto) {
        <div class="tk-fila tk-item"><span>{{ item.nombre_producto }}</span><span>{{ item.cantidad }}</span></div>
      }

      <hr class="tk-linea">
      <div class="tk-fila tk-total"><span>UNIDADES</span><span>{{ unidades() }}</span></div>
      @if (t().observacion) { <p class="tk-dato">Obs.: {{ t().observacion }}</p> }

      <p class="tk-pie">Recibido por: ____________________</p>
    </div>
  `
})
export class ComprobanteTransferenciaComponent {
  readonly ajustes = inject(AjustesService);
  readonly t = input.required<Transferencia>();

  readonly ancho    = computed(() => this.ajustes.config().ticket_ancho || '80');
  readonly unidades = computed(() => (this.t().items || []).reduce((s, i) => s + Number(i.cantidad), 0));
  readonly fecha    = computed(() => fechaHora(this.t().fecha_transferencia));
}
