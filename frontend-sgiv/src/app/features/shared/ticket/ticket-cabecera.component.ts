import { Component, ViewEncapsulation, inject, input } from '@angular/core';
import { AjustesService } from '../../../core/services/ajustes.service';

// ─── Cabecera común de todos los comprobantes: logo y datos de la empresa (Ajustes → Empresa) ───
@Component({
  selector: 'app-ticket-cabecera',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="tk-cabecera">
      @if (ajustes.logo()) { <img class="tk-logo" [src]="ajustes.logo()" alt=""> }
      <p class="tk-nombre">{{ ajustes.nombre() }}</p>
      @if (c().razon_social) { <p class="tk-dato">{{ c().razon_social }}</p> }
      @if (c().nit) { <p class="tk-dato">NIT: {{ c().nit }}</p> }
      @if (c().direccion) { <p class="tk-dato">{{ c().direccion }}</p> }
      @if (c().telefono || c().whatsapp) { <p class="tk-dato">Tel.: {{ c().telefono || c().whatsapp }}</p> }
      @if (titulo()) { <p class="tk-titulo">{{ titulo() }}</p> }
    </div>
  `
})
export class TicketCabeceraComponent {
  readonly ajustes = inject(AjustesService);
  readonly c = this.ajustes.config;
  readonly titulo = input('');
}
