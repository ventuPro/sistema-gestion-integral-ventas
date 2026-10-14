import { Injectable, computed, signal } from '@angular/core';

export interface OpcionesConfirmacion {
  titulo:          string;
  mensaje?:        string;
  textoConfirmar?: string;
  peligro?:        boolean;
}

interface Confirmacion extends OpcionesConfirmacion { responder: (si: boolean) => void }

// ─── Diálogos y avisos de toda la app (reemplazan a confirm() y alert()) ───
// Los muestra <app-dialogos>, montado una sola vez en AppComponent.
@Injectable({ providedIn: 'root' })
export class DialogoService {
  readonly confirmacion = signal<Confirmacion | null>(null);
  readonly aviso        = signal<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  /** Hay algo que mostrar: AppComponent descarga <app-dialogos> recién entonces */
  readonly activo       = computed(() => !!this.confirmacion() || !!this.aviso());
  private temporizador: any;

  /** Uso: if (!(await this.dialogo.confirmar({ titulo: '¿Eliminar…?' }))) return; */
  confirmar(opciones: OpcionesConfirmacion): Promise<boolean> {
    this.confirmacion()?.responder(false);
    return new Promise(resolver => this.confirmacion.set({
      ...opciones,
      responder: (si) => { this.confirmacion.set(null); resolver(si); }
    }));
  }

  avisar(texto: string, tipo: 'ok' | 'error' = 'ok') {
    clearTimeout(this.temporizador);
    this.aviso.set({ texto, tipo });
    this.temporizador = setTimeout(() => this.aviso.set(null), tipo === 'error' ? 5000 : 3500);
  }

  error(texto: string) { this.avisar(texto, 'error'); }
}
