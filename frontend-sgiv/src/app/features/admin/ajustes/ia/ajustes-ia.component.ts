import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, Save, Undo2, Zap } from 'lucide-angular';
import { AjustesService, PruebaChatbot } from '../../../../core/services/ajustes.service';

export const MAX_INFO_CHATBOT = 3000;

// ─── Ajustes → Chatbot ───
// Los chatbots están siempre activos (si el servidor tiene la clave de Groq);
// el modelo y los límites los maneja el sistema. Aquí solo se "entrena" al
// asistente del menú con información del propietario y se prueba la conexión.
@Component({
  selector: 'app-ajustes-ia',
  standalone: true,
  imports: [NgTemplateOutlet, LucideAngularModule],
  templateUrl: './ajustes-ia.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css']
})
export class AjustesIaComponent implements OnInit {
  readonly ajustes = inject(AjustesService);

  readonly icons = { guardar: Save, descartar: Undo2, probar: Zap };
  readonly maximo = MAX_INFO_CHATBOT;

  readonly conClave  = computed(() => this.ajustes.config().ia_cliente_disponible);
  readonly cargando  = signal(true);
  readonly guardando = signal(false);
  readonly mensaje   = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  readonly info     = signal('');
  private  guardado = signal('');
  readonly hayCambios = computed(() => this.info().trim() !== this.guardado());

  readonly probando    = signal(false);
  readonly prueba      = signal<{ menu: PruebaChatbot; personal: PruebaChatbot } | null>(null);
  readonly errorPrueba = signal('');

  ngOnInit() {
    this.ajustes.obtenerCompleto().subscribe({
      next: (c) => { this.llenar(c.ia_info_negocio); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.avisar('error', 'No se pudieron cargar los ajustes.'); }
    });
  }

  private llenar(valor?: string | null) {
    this.info.set(valor || '');
    this.guardado.set(valor || '');
  }

  escribir(evento: Event) {
    this.info.set((evento.target as HTMLTextAreaElement).value);
  }

  probar() {
    this.probando.set(true);
    this.prueba.set(null);
    this.errorPrueba.set('');
    this.ajustes.probarIa().subscribe({
      next: (r) => { this.prueba.set({ menu: r.cliente, personal: r.interno }); this.probando.set(false); },
      error: (e) => {
        this.errorPrueba.set(e?.error?.error || 'No se pudo conectar con el servicio de IA.');
        this.probando.set(false);
      }
    });
  }

  descartar() { this.info.set(this.guardado()); }

  guardar() {
    if (this.info().length > MAX_INFO_CHATBOT)
      return this.avisar('error', `La información admite hasta ${MAX_INFO_CHATBOT} caracteres.`);
    this.guardando.set(true);
    this.ajustes.guardarIa({ ia_info_negocio: this.info() }).subscribe({
      next: (r) => { this.llenar(r.configuracion.ia_info_negocio); this.guardando.set(false); this.avisar('ok', 'Información del chatbot guardada'); },
      error: (e) => { this.guardando.set(false); this.avisar('error', e?.error?.error || 'No se pudo guardar.'); }
    });
  }

  private avisar(tipo: 'ok' | 'error', texto: string) {
    this.mensaje.set({ tipo, texto });
    setTimeout(() => this.mensaje.set(null), 4500);
  }
}
