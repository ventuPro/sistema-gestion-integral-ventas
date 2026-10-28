import { Directive, ElementRef, inject, output } from '@angular/core';

// ─── Cierre de ventanas al tocar el fondo ───
// Solo cierra si el clic empezó y terminó en el fondo: seleccionar texto
// en un campo y soltar fuera de la ventana no la cierra.
@Directive({
  selector: '[fondoModal]',
  standalone: true,
  host: {
    '(pointerdown)': 'alPresionar($event)',
    '(click)': 'alHacerClic($event)'
  }
})
export class FondoModalDirective {
  readonly fondoModal = output<void>();
  private readonly fondo: HTMLElement = inject(ElementRef).nativeElement;
  private presionado = false;

  // Sin valor de retorno: si devolviera false, Angular bloquearía el foco de los campos
  protected alPresionar(evento: PointerEvent) {
    this.presionado = evento.target === this.fondo;
  }

  protected alHacerClic(evento: MouseEvent) {
    if (this.presionado && evento.target === this.fondo) this.fondoModal.emit();
    this.presionado = false;
  }
}
