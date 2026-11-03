import { Component, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { LucideAngularModule, Printer, X } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { ImpresionService } from '../../../core/services/impresion.service';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';

// ─── Ventana con la vista previa de un ticket, «Imprimir» y «Cerrar» (como el comprobante de Punto de venta) ───
@Component({
  selector: 'app-vista-ticket',
  standalone: true,
  imports: [LucideAngularModule, FondoModalDirective],
  styleUrls: ['../informe/informe.css', '../venta/venta.css'],
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 fondo-modal" (fondoModal)="cerrar.emit()">
      <div class="inf-hoja ventana w-full max-w-md flex flex-col max-h-[90vh]" (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between px-5 py-4 separador-inferior">
          <div>
            <h3 class="inf-tinta font-semibold text-[length:calc(15px*var(--escala-texto))]">{{ titulo() }}</h3>
            @if (subtitulo()) { <p class="inf-sub mt-0!">{{ subtitulo() }}</p> }
          </div>
          <button class="quitar" (click)="cerrar.emit()" aria-label="Cerrar">
            <lucide-icon [img]="icons.cerrar" class="w-4 h-4"></lucide-icon>
          </button>
        </div>
        <div #zona class="overflow-y-auto p-4 flex justify-center" style="background: var(--i-fondo)">
          <div class="shadow-sm"><ng-content /></div>
        </div>
        <div class="inf-pie-hoja flex justify-end gap-2">
          <button class="inf-boton" (click)="imprimir()">
            <lucide-icon [img]="icons.imprimir" class="w-4 h-4"></lucide-icon> Imprimir
          </button>
          <button class="boton-primario" data-enter (click)="cerrar.emit()">Cerrar</button>
        </div>
      </div>
    </div>
  `
})
export class VistaTicketComponent {
  private impresion = inject(ImpresionService);
  private ajustes   = inject(AjustesService);

  readonly titulo    = input.required<string>();
  readonly subtitulo = input('');
  readonly cerrar    = output<void>();

  readonly icons = { cerrar: X, imprimir: Printer };
  private zona = viewChild<ElementRef<HTMLElement>>('zona');

  imprimir() {
    this.impresion.imprimirTicket(this.zona()?.nativeElement, this.ajustes.config().ticket_ancho);
    this.cerrar.emit();
  }
}
