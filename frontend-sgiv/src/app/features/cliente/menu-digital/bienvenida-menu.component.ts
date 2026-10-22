import { Component, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ArrowRight, BookOpen, CakeSlice, Coffee, Cookie, Croissant, CupSoda, Dessert, IceCreamCone, Send, Sparkles, Wallet } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { CarruselRecomendadosComponent } from './carrusel-recomendados.component';
import { saludo } from './ficha';

// ─── Bienvenida del menú QR: saludo, recomendados y nombre del cliente ───
@Component({
  selector:    'app-bienvenida-menu',
  standalone:  true,
  imports:     [FormsModule, LucideAngularModule, CarruselRecomendadosComponent],
  templateUrl: './bienvenida-menu.component.html',
  styleUrls:   ['../../shared/venta/venta.css', '../../shared/formulario/formulario.css', './bienvenida-menu.component.css']
})
export class BienvenidaMenuComponent {
  readonly mesa          = input.required<{ numero_mesa: number; nombre_sucursal: string; recibe_pedidos: boolean }>();
  readonly recomendados  = input<any[]>([]);
  readonly promociones   = input(0);
  readonly nombre        = model('');
  readonly entrar        = output<void>();

  readonly ajustes = inject(AjustesService);
  readonly moneda  = this.ajustes.moneda;
  readonly saludo  = saludo();
  readonly icons   = { entrar: ArrowRight, promo: Sparkles };
  readonly siluetas = [CakeSlice, Croissant, Coffee, Cookie, Dessert, IceCreamCone, CupSoda, CakeSlice];
  readonly pasos = [
    { icono: BookOpen, texto: 'Elige del menú' },
    { icono: Send,     texto: 'Envía tu pedido' },
    { icono: Wallet,   texto: 'Paga en caja' }
  ];
}
