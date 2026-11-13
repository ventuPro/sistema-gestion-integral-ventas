import { Component, inject, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, CakeSlice, X } from 'lucide-angular';
import { Encargo, estadoPago } from '../../../core/services/encargo.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { cifra, fechaDia } from '../../../core/utils/informe';

// ─── Ventana del primer ingreso del día: encargos por entregar hoy (y atrasados) ───
@Component({
  selector: 'app-aviso-encargos',
  standalone: true,
  imports: [NgClass, LucideAngularModule, FondoModalDirective],
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css'],
  styles: [`
    .encargos { display: flex; flex-direction: column; gap: 8px; }
    .encargos li { display: flex; gap: 12px; padding: 10px 12px; border: 1px solid var(--i-linea); border-left: 4px solid var(--i-acento); border-radius: 8px; }
    .encargos li.atrasado { border-left-color: var(--i-baja); }
    .hora { min-width: 52px; font-weight: 700; color: var(--i-tinta); font-size: calc(16px * var(--escala-texto)); }
    .cliente { font-weight: 600; color: var(--i-tinta); font-size: calc(14px * var(--escala-texto)); }
  `],
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 fondo-modal" (fondoModal)="cerrar.emit()">
      <div class="inf-hoja ventana w-full max-w-lg flex flex-col max-h-[85vh]" (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between px-5 py-4 separador-inferior">
          <h3 class="inf-tinta font-semibold flex items-center gap-2 text-[length:calc(15px*var(--escala-texto))]">
            <lucide-icon [img]="icons.encargo" class="w-5 h-5 inf-aviso"></lucide-icon>
            {{ encargos().length === 1 ? 'Hay 1 encargo para hoy' : 'Hay ' + encargos().length + ' encargos para hoy' }}
          </h3>
          <button class="quitar" (click)="cerrar.emit()" aria-label="Cerrar">
            <lucide-icon [img]="icons.cerrar" class="w-4 h-4"></lucide-icon>
          </button>
        </div>
        <ul class="encargos overflow-y-auto p-4">
          @for (e of encargos(); track e.id_encargo) {
            <li [class.atrasado]="e.atrasado">
              <span class="hora">{{ e.hora }}</span>
              <span class="flex-1 min-w-0">
                <span class="cliente block">{{ e.nombre_cliente }}</span>
                <span class="inf-secundario">
                  {{ e.celular_cliente }} · {{ e.tipo_evento }}@if (e.fecha !== hoy) { · {{ fechaDia(e.fecha) }} }@if (multiSucursal()) { · {{ e.nombre_sucursal }} }
                </span>
                <span class="inf-secundario truncate">{{ resumen(e) }}</span>
              </span>
              <span class="text-right shrink-0">
                @if (e.atrasado) { <span class="inf-estado mal block">Atrasado</span> }
                <span class="inf-estado block" [ngClass]="pago(e).clase">
                  {{ e.saldo && e.adelanto ? 'Saldo ' + moneda() + ' ' + cifra(e.saldo) : pago(e).texto }}
                </span>
              </span>
            </li>
          }
        </ul>
        <div class="inf-pie-hoja flex justify-end gap-2">
          <button class="inf-boton" (click)="cerrar.emit()">Cerrar</button>
          <button class="boton-primario" data-enter (click)="verEncargos.emit()">Ver encargos</button>
        </div>
      </div>
    </div>
  `
})
export class AvisoEncargosComponent {
  readonly moneda = inject(AjustesService).moneda;
  readonly encargos = input.required<Encargo[]>();
  readonly multiSucursal = input(false);
  readonly cerrar = output<void>();
  readonly verEncargos = output<void>();

  readonly icons = { encargo: CakeSlice, cerrar: X };
  readonly cifra = cifra;
  readonly fechaDia = fechaDia;
  readonly hoy = new Date().toLocaleDateString('en-CA');

  pago(e: Encargo) { return estadoPago(e); }
  resumen(e: Encargo) { return e.items.map(i => `${i.cantidad} ${i.descripcion}`).join(', '); }
}
