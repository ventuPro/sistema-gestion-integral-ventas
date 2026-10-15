import { Component, ElementRef, input, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Observable } from 'rxjs';
import { LucideAngularModule, Sparkles, X, SendHorizontal, RotateCcw } from 'lucide-angular';

export interface MensajeChat { rol: 'usuario' | 'asistente'; texto: string; error?: boolean }
interface MensajeVista extends MensajeChat { bloques?: Bloque[] }

const MAX_GUARDADOS = 20;

type Parte = { texto: string; negrita: boolean };
export type Bloque = { lista: false; partes: Parte[] } | { lista: true; items: Parte[][] };

// **negrita** o *énfasis* (ambos se muestran en negrita)
const partes = (linea: string): Parte[] => {
  const lista: Parte[] = [];
  let desde = 0;
  for (const m of linea.matchAll(/\*\*(.+?)\*\*|\*([^*\s][^*]*)\*/g)) {
    if (m.index > desde) lista.push({ texto: linea.slice(desde, m.index), negrita: false });
    lista.push({ texto: m[1] ?? m[2], negrita: true });
    desde = m.index + m[0].length;
  }
  if (desde < linea.length) lista.push({ texto: linea.slice(desde), negrita: false });
  return lista;
};

/** Texto del modelo → párrafos y listas con **negrita**. Se dibuja con la plantilla (sin innerHTML). */
export const formatearRespuesta = (texto: string): Bloque[] => {
  const bloques: Bloque[] = [];
  for (const linea of texto.split('\n')) {
    const item = /^\s*[-*•]\s+(.*)$/.exec(linea);
    const ultimo = bloques.at(-1);
    if (item) {
      if (ultimo?.lista) ultimo.items.push(partes(item[1]));
      else bloques.push({ lista: true, items: [partes(item[1])] });
    } else if (linea.trim()) {
      bloques.push({ lista: false, partes: partes(linea.trim()) });
    }
  }
  return bloques;
};

// ─── Chat con un asistente de IA (menú QR y panel) ───
// La conversación queda en sessionStorage: se borra al cerrar la pestaña.
@Component({
  selector: 'app-asistente-chat',
  standalone: true,
  imports: [NgTemplateOutlet, LucideAngularModule],
  templateUrl: './asistente-chat.component.html',
  styleUrls: ['../informe/informe.css', './asistente-chat.component.css']
})
export class AsistenteChatComponent {
  readonly titulo      = input('Asistente');
  readonly subtitulo   = input('');
  readonly saludo      = input('¡Hola! ¿En qué te ayudo?');
  readonly etiqueta    = input('Pregúntame');
  readonly sugerencias = input<string[]>([]);
  /** Clave para recordar la conversación en la pestaña */
  readonly clave       = input.required<string>();
  /** Sube el botón (el menú QR tiene la barra del carrito abajo) */
  readonly elevado     = input(false);
  readonly enviar      = input.required<(mensajes: MensajeChat[]) => Observable<{ respuesta: string }>>();

  readonly icons = { chat: Sparkles, cerrar: X, enviar: SendHorizontal, limpiar: RotateCcw };

  readonly abierto   = signal(false);
  readonly mensajes  = signal<MensajeVista[]>([]);
  readonly pensando  = signal(false);
  readonly texto    = signal('');

  private lista = viewChild<ElementRef<HTMLElement>>('lista');
  private campo = viewChild<ElementRef<HTMLTextAreaElement>>('campo');

  abrir() {
    if (!this.mensajes().length) this.mensajes.set(this.leer().map(m => this.vista(m)));
    this.abierto.set(true);
    this.alFinal(true);
  }

  cerrar() { this.abierto.set(false); }

  limpiar() {
    this.mensajes.set([]);
    this.guardar();
  }

  mandar(texto = this.texto()) {
    texto = texto.trim();
    if (!texto || this.pensando()) return;
    this.texto.set('');
    const campo = this.campo()?.nativeElement;
    if (campo) campo.value = '';
    // Los avisos de error no se envían como parte de la conversación
    const historial: MensajeChat[] = [...this.mensajes().filter(m => !m.error).map(({ rol, texto }) => ({ rol, texto })),
                                      { rol: 'usuario', texto: texto.slice(0, 500) }];
    this.mensajes.update(l => [...l, { rol: 'usuario', texto }]);
    this.pensando.set(true);
    this.alFinal();

    this.enviar()(historial).subscribe({
      next: (r) => this.responder({ rol: 'asistente', texto: r.respuesta }),
      error: (e) => this.responder({ rol: 'asistente', error: true,
        texto: e?.error?.error || 'No pude responder. Revisa tu conexión e intenta de nuevo.' })
    });
  }

  teclear(evento: KeyboardEvent) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      this.mandar();
    }
  }

  private vista(m: MensajeChat): MensajeVista {
    return m.rol === 'asistente' ? { ...m, bloques: formatearRespuesta(m.texto) } : m;
  }

  private responder(m: MensajeChat) {
    this.pensando.set(false);
    this.mensajes.update(l => [...l, this.vista(m)]);
    this.guardar();
    this.alFinal(true);
  }

  private alFinal(enfocar = false) {
    setTimeout(() => {
      const el = this.lista()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      if (enfocar && window.matchMedia('(min-width: 640px)').matches) this.campo()?.nativeElement.focus();
    });
  }

  private leer(): MensajeChat[] {
    try { return JSON.parse(sessionStorage.getItem(`asistente_${this.clave()}`) || '[]'); } catch { return []; }
  }

  private guardar() {
    try { sessionStorage.setItem(`asistente_${this.clave()}`, JSON.stringify(this.mensajes().slice(-MAX_GUARDADOS).map(({ bloques, ...m }) => m))); } catch { }
  }
}
