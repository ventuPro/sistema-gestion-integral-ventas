import { Component, HostListener, inject } from '@angular/core';
import { DialogoService } from '../../../core/services/dialogo.service';
import { ConfirmacionComponent } from '../confirmacion/confirmacion.component';

// ─── Muestra los diálogos y avisos pedidos a DialogoService ───
@Component({
  selector: 'app-dialogos',
  standalone: true,
  imports: [ConfirmacionComponent],
  styleUrls: ['../informe/informe.css', '../venta/venta.css'],
  template: `
    @if (dialogo.aviso(); as a) {
      <div class="aviso-flotante" [class.error]="a.tipo === 'error'" [attr.role]="a.tipo === 'error' ? 'alert' : 'status'">{{ a.texto }}</div>
    }
    @if (dialogo.confirmacion(); as c) {
      <app-confirmacion [titulo]="c.titulo" [mensaje]="c.mensaje || ''" [textoConfirmar]="c.textoConfirmar || 'Confirmar'"
                        [peligro]="!!c.peligro" (confirmar)="c.responder(true)" (cancelar)="c.responder(false)" />
    }
  `
})
export class DialogosComponent {
  readonly dialogo = inject(DialogoService);

  @HostListener('document:keydown.escape')
  alPresionarEscape() { this.dialogo.confirmacion()?.responder(false); }
}
