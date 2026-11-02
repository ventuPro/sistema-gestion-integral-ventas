import { Component, input } from '@angular/core';
import { LucideAngularModule, Delete } from 'lucide-angular';
import { EntradaNumero } from './entrada-numero';

// ─── Tablero numérico en pantalla (tablets y pantallas táctiles) ───
// No toma el foco: el cursor sigue donde estaba y no se abre el teclado del celular.
@Component({
  selector: 'app-teclado-numerico',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './teclado-numerico.component.html',
  styleUrl: './teclado-numerico.component.css'
})
export class TecladoNumericoComponent {
  readonly entrada       = input.required<EntradaNumero>();
  readonly etiqueta      = input('');
  readonly billetes      = input<number[]>([]);
  readonly deshabilitado = input(false);
  /** false cuando el valor ya se ve en un campo de la pantalla */
  readonly pantalla      = input(true);

  readonly icons = { borrar: Delete };
  readonly digitos = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  pulsar(tecla: string) {
    if (!this.deshabilitado()) this.entrada().tecla(tecla);
  }

  sumar(monto: number) {
    if (!this.deshabilitado()) this.entrada().sumar?.(monto);
  }
}
