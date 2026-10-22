import { Component, input, output } from '@angular/core';
import { LucideAngularModule, LucideIconData, X, ArrowRight, Sparkles } from 'lucide-angular';

// ─── Panel inferior del menú QR: categorías o promociones de hoy ───
@Component({
  selector:    'app-panel-menu',
  standalone:  true,
  imports:     [LucideAngularModule],
  templateUrl: './panel-menu.component.html',
  styleUrls:   ['./panel-menu.component.css']
})
export class PanelMenuComponent {
  readonly tipo              = input.required<'categorias' | 'promos'>();
  readonly categorias        = input<{ id: number; nombre: string; icono: LucideIconData; cantidad: number }[]>([]);
  readonly seccionActual     = input<number | null>(null);
  readonly promociones       = input<{ nombre: string; texto: string }[]>([]);
  readonly productosPorPromo = input<Record<string, number>>({});
  readonly cerrar            = output<void>();
  readonly categoria         = output<number>();
  readonly promo             = output<string>();

  readonly icons = { cerrar: X, ver: ArrowRight, promo: Sparkles };
}
