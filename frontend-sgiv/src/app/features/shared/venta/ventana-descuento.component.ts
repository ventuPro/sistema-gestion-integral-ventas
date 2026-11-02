import { Component, computed, inject, input, output, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X } from 'lucide-angular';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { AjustesService } from '../../../core/services/ajustes.service';
import { FormDescuento } from '../../../core/services/promocion.service';
import { TecladoNumericoComponent } from '../teclado-numerico/teclado-numerico.component';
import { campoDe, EntradaMonto } from '../teclado-numerico/entrada-numero';

// ─── Descuento manual (Punto de venta y Mesas): datos a la izquierda, tablero a la derecha ───
@Component({
  selector: 'app-ventana-descuento',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, FondoModalDirective, TecladoNumericoComponent],
  templateUrl: './ventana-descuento.component.html',
  styleUrls: ['../informe/informe.css', './venta.css', './ventana-descuento.component.css']
})
export class VentanaDescuentoComponent {
  readonly form      = input.required<WritableSignal<FormDescuento>>();
  readonly error     = input('');
  readonly aplicando = input(false);
  readonly aplicar   = output<void>();
  readonly cancelar  = output<void>();

  readonly moneda  = inject(AjustesService).moneda;
  readonly icons   = { cerrar: X };
  readonly entrada = computed(() => new EntradaMonto(campoDe(this.form(), 'valor')));

  tipo(tipo: FormDescuento['tipo']) {
    this.form().update(f => ({ ...f, tipo }));
  }
}
