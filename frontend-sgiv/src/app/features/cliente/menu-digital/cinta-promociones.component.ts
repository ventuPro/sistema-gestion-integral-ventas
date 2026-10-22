import { Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, ChevronRight, Gift } from 'lucide-angular';

// ─── Franja de promociones al inicio del menú QR ───
@Component({
  selector:    'app-cinta-promociones',
  standalone:  true,
  imports:     [LucideAngularModule],
  template: `
    <button class="cinta" (click)="abrir.emit()" aria-haspopup="dialog">
      <span class="regalo"><lucide-icon [img]="icons.regalo" class="w-6 h-6" [strokeWidth]="1.75"></lucide-icon></span>
      <span class="textos">
        <span class="titulo">Promociones <span class="cantidad">{{ promociones().length }} hoy</span></span>
        <span class="detalle">{{ detalle() }}</span>
      </span>
      <span class="ver">Ver <lucide-icon [img]="icons.ver" class="w-4 h-4"></lucide-icon></span>
    </button>`,
  styleUrls: ['./cinta-promociones.component.css']
})
export class CintaPromocionesComponent {
  readonly promociones = input.required<{ nombre: string; texto: string }[]>();
  readonly abrir       = output<void>();

  readonly icons = { regalo: Gift, ver: ChevronRight };
  readonly detalle = computed(() => {
    const [primera, ...resto] = this.promociones();
    return (primera?.texto ?? '') + (resto.length ? ` y ${resto.length} más` : '');
  });
}
