import { Component, ViewContainerRef, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogoService } from './core/services/dialogo.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private dialogo = inject(DialogoService);
  private vista   = inject(ViewContainerRef);
  private montado = false;

  constructor() {
    // Diálogos y avisos: el componente (y sus estilos) se descarga la primera vez que se usa
    effect(() => {
      if (!this.dialogo.activo() || this.montado) return;
      this.montado = true;
      import('./features/shared/dialogos/dialogos.component')
        .then(m => this.vista.createComponent(m.DialogosComponent));
    });
  }
}
