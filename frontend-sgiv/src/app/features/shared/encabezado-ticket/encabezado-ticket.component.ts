import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AjustesService } from '../../../core/services/ajustes.service';

// ─── Encabezado de comprobantes con los datos del negocio (Ajustes → Empresa) ───
@Component({
  selector: 'app-encabezado-ticket',
  standalone: true,
  imports: [CommonModule],
  template: `
    <img *ngIf="ajustes.logo()" [src]="ajustes.logo()" alt="" class="h-12 mx-auto mb-1 object-contain">
    <h2 class="text-xl font-black">{{ c().nombre_comercial }}</h2>
    <p *ngIf="c().razon_social" class="text-xs text-gray-500">{{ c().razon_social }}</p>
    <p *ngIf="c().nit" class="text-xs text-gray-500">NIT: {{ c().nit }}</p>
    <p *ngIf="c().direccion" class="text-xs text-gray-500">{{ c().direccion }}</p>
    <p *ngIf="c().telefono || c().whatsapp" class="text-xs text-gray-500">Tel.: {{ c().telefono || c().whatsapp }}</p>
  `
})
export class EncabezadoTicketComponent {
  readonly ajustes = inject(AjustesService);
  readonly c = this.ajustes.config;
}
