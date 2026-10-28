import { afterNextRender, Directive, ElementRef, inject, OnDestroy, output } from '@angular/core';

// ─── Ventanas modales: fondo, teclado y foco ───
// - Cierra solo si el clic empieza y termina en el fondo (seleccionar texto y soltar fuera no la cierra).
// - Esc cierra la ventana de más arriba.
// - Al abrir enfoca [autofocus], el primer campo o el botón [data-enter]; al cerrar devuelve el foco.
// - Enter en un campo (fuera de un <form>) pulsa el botón [data-enter] de la ventana.
const CAMPOS = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=color]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])';
const abiertas: FondoModalDirective[] = [];

/** Celular o tableta: enfocar un campo abriría el teclado sin que lo pidan */
export const pantallaTactil = () => !matchMedia('(hover: hover) and (pointer: fine)').matches;

/** El cursor está en un campo o en otra ventana: no hay que quitárselo. `propia` = la ventana desde la que se llama */
export const focoOcupado = (propia: HTMLElement | null = null) => {
  const actual = document.activeElement as HTMLElement | null;
  if (!actual || actual === document.body) return false;
  if (actual.matches(CAMPOS) || actual.isContentEditable) return true;
  const ventana = actual.closest('.fondo-modal');
  return !!ventana && ventana !== propia;
};

/** Enter en un campo: si después hay otro vacío, lo enfoca y devuelve true (no se guarda todavía) */
export const pasarAlSiguienteVacio = (evento: Event, contenedor: HTMLElement) => {
  const campo = evento.target as HTMLElement;
  const campos = [...contenedor.querySelectorAll<HTMLInputElement | HTMLSelectElement>(CAMPOS)]
    .filter(c => c.tagName !== 'TEXTAREA' && c.getClientRects().length);
  const posicion = campos.indexOf(campo as HTMLInputElement);
  const siguiente = posicion < 0 ? null : campos.slice(posicion + 1).find(c => c.value === '');
  if (!siguiente) return false;
  evento.preventDefault();
  enfocar(siguiente);
  return true;
};

/** Enfoca un elemento si existe y está visible */
export const enfocar = (el: HTMLElement | null | undefined) => {
  if (!el || !el.isConnected || !el.getClientRects().length) return false;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && ['text', 'number', 'search', 'email', 'tel'].includes(el.type)) el.select();
  return document.activeElement === el;
};

@Directive({
  selector: '[fondoModal]',
  standalone: true,
  host: {
    '(pointerdown)': 'alPresionar($event)',
    '(click)': 'alHacerClic($event)',
    '(keydown.enter)': 'alPresionarEnter($event)',
    '(document:keydown.escape)': 'alPresionarEscape($event)'
  }
})
export class FondoModalDirective implements OnDestroy {
  readonly fondoModal = output<void>();
  private readonly fondo: HTMLElement = inject(ElementRef).nativeElement;
  private readonly previo = document.activeElement as HTMLElement | null;
  private presionado = false;

  constructor() {
    abiertas.push(this);
    afterNextRender(() => this.enfocarInicio());
  }

  ngOnDestroy() {
    abiertas.splice(abiertas.indexOf(this), 1);
    const previo = this.previo;
    // Devuelve el foco si quedó en la nada (la ventana ya no existe)
    setTimeout(() => {
      const actual = document.activeElement;
      if ((!actual || actual === document.body) && previo && previo !== document.body) enfocar(previo);
    });
  }

  private enfocarInicio() {
    if (this.fondo.contains(document.activeElement)) return;
    const marcado = this.fondo.querySelector<HTMLElement>('[autofocus]');
    const campo = [...this.fondo.querySelectorAll<HTMLElement>(CAMPOS)].find(c => c.getClientRects().length);
    const boton = this.fondo.querySelector<HTMLElement>('[data-enter]:not([disabled])');
    const tactil = pantallaTactil();
    for (const el of [marcado, tactil ? null : campo, boton]) {
      if (el && !(tactil && el.matches(CAMPOS)) && enfocar(el)) return;
    }
  }

  // Sin valor de retorno: si devolviera false, Angular bloquearía el foco de los campos
  protected alPresionar(evento: PointerEvent) {
    this.presionado = evento.target === this.fondo;
  }

  protected alHacerClic(evento: MouseEvent) {
    if (this.presionado && evento.target === this.fondo) this.fondoModal.emit();
    this.presionado = false;
  }

  // Enter pasa al siguiente campo vacío; si no queda ninguno, guarda
  protected alPresionarEnter(evento: Event) {
    const campo = evento.target as HTMLElement;
    if (evento.defaultPrevented || !(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement)) return;
    if (campo.type === 'checkbox' || campo.type === 'radio') return;
    const ventana = (campo.closest('.ventana') ?? this.fondo) as HTMLElement;
    if (pasarAlSiguienteVacio(evento, ventana) || campo.form) return;  // el <form> se envía solo
    const boton = ventana.querySelector<HTMLButtonElement>('[data-enter]');
    if (!boton || boton.disabled) return;
    evento.preventDefault();
    boton.click();
  }

  protected alPresionarEscape(evento: Event) {
    if (abiertas[abiertas.length - 1] !== this || evento.defaultPrevented) return;
    evento.preventDefault();
    this.fondoModal.emit();
  }
}
