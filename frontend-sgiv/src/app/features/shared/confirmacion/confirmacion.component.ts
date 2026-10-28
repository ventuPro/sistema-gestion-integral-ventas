import { Component, input, output } from '@angular/core';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';

// ─── Diálogo de confirmación (reemplaza a confirm()) ───
@Component({
  selector: 'app-confirmacion',
  standalone: true,
  imports: [FondoModalDirective],
  styleUrls: ['../informe/informe.css', '../venta/venta.css', '../formulario/formulario.css'],
  template: `
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4 fondo-modal" (fondoModal)="cancelar.emit()">
      <div class="inf-hoja ventana w-full max-w-sm" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
        <div class="p-5">
          <h3 class="inf-tinta font-semibold text-[15px]">{{ titulo() }}</h3>
          @if (mensaje()) { <p class="text-[13.5px] mt-2 leading-relaxed">{{ mensaje() }}</p> }
          @if (error()) { <p class="error-formulario mt-3">{{ error() }}</p> }
        </div>
        <div class="inf-pie-hoja flex justify-end gap-2">
          <button class="inf-boton" (click)="cancelar.emit()" [disabled]="ocupado()">Cancelar</button>
          <button [class]="peligro() ? 'boton-peligro' : 'boton-primario'" (click)="confirmar.emit()" [disabled]="ocupado()">
            {{ ocupado() ? 'Procesando…' : textoConfirmar() }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmacionComponent {
  titulo         = input.required<string>();
  mensaje        = input('');
  textoConfirmar = input('Confirmar');
  peligro        = input(false);
  ocupado        = input(false);
  error          = input('');
  confirmar      = output<void>();
  cancelar       = output<void>();
}
