import { Injectable, signal } from '@angular/core';

const CLAVE = 'teclado_sgiv';

// ─── Tablero numérico en pantalla: visible solo en equipos táctiles, salvo que se elija otra cosa ───
// La elección se guarda en cada equipo.
@Injectable({ providedIn: 'root' })
export class TecladoService {
  readonly visible = signal(this.leer());

  alternar() {
    this.visible.update(v => !v);
    try { localStorage.setItem(CLAVE, this.visible() ? '1' : '0'); } catch { }
  }

  private leer(): boolean {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado !== null) return guardado === '1';
    } catch { }
    // Laptops táctiles reportan el touchpad como puntero principal: se mira cualquier puntero
    return !!window.matchMedia?.('(any-pointer: coarse)').matches;
  }
}
