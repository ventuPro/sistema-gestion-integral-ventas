import { Component, input, output } from '@angular/core';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';

// ─── Diálogo de confirmación (reemplaza a confirm()) ───
@Component({
  selector: 'app-confirmacion',
  standalone: true,
  imports: [FondoModalDirective],
  styleUrls: ['../informe/informe.css', '../venta/venta.css', '../formulario/formulario.css'],
  styles: [`
    .advertencias { margin-top: 12px; padding: 10px 12px 10px 28px; border-radius: 10px; list-style: disc;
                    background: #fffbeb; border: 1px solid #fcd34d; color: #92400e;
                    font-size: calc(13px * var(--escala-texto)); line-height: 1.45; }
    .advertencias li + li { margin-top: 4px; }
    :host-context(.tema-oscuro) .advertencias { background: rgb(146 64 14 / 0.18); border-color: rgb(252 211 77 / 0.35); color: #fcd34d; }
  `],
  template: `
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4 fondo-modal" (fondoModal)="!ocupado() && cancelar.emit()">
      <div class="inf-hoja ventana w-full" [class.max-w-sm]="!advertencias().length" [class.max-w-md]="advertencias().length > 0" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
        <div class="p-5">
          <h3 class="inf-tinta font-semibold text-[length:calc(15px*var(--escala-texto))]">{{ titulo() }}</h3>
          @if (mensaje()) { <p class="text-[length:calc(13.5px*var(--escala-texto))] mt-2 leading-relaxed whitespace-pre-line">{{ mensaje() }}</p> }
          @if (advertencias().length) {
            <ul class="advertencias">
              @for (a of advertencias(); track a) { <li>{{ a }}</li> }
            </ul>
          }
          @if (error()) { <p class="error-formulario mt-3">{{ error() }}</p> }
        </div>
        <div class="inf-pie-hoja flex justify-end gap-2">
          <button class="inf-boton" (click)="cancelar.emit()" [disabled]="ocupado()" [attr.autofocus]="peligro() ? '' : null">Cancelar</button>
          <button [class]="peligro() ? 'boton-peligro' : 'boton-primario'" data-enter (click)="confirmar.emit()" [disabled]="ocupado()">
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
  /** Qué cambia en el funcionamiento (se muestra como lista resaltada) */
  advertencias   = input<string[]>([]);
  ocupado        = input(false);
  error          = input('');
  confirmar      = output<void>();
  cancelar       = output<void>();
}
