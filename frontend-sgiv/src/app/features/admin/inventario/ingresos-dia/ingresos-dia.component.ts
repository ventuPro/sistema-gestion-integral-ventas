import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LucideAngularModule, X, Printer } from 'lucide-angular';
import { InventarioService, IngresoDia } from '../../../../core/services/inventario.service';
import { SocketService } from '../../../../core/services/socket.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { ImpresionService } from '../../../../core/services/impresion.service';
import { fechaLarga } from '../../../../core/utils/informe';
import { GrupoListaDia, TicketListaDiaComponent } from '../../../shared/ticket/ticket-lista-dia.component';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

interface FilaProducto { id_producto: number; nombre_producto: string; cantidad: number; entradas: number; ultima: string }
interface GrupoIngresos { id: number; categoria: string; orden: number; productos: FilaProducto[] }

const hoy = () => new Date().toLocaleDateString('en-CA');   // AAAA-MM-DD en hora local

// ─── Inventario → «Ingresos del día»: lo que se produjo o llegó, por producto y en detalle ───
@Component({
  selector: 'app-ingresos-dia',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, LucideAngularModule, TicketListaDiaComponent],
  templateUrl: './ingresos-dia.component.html',
  styleUrls: ['../../../shared/informe/informe.css', './ingresos-dia.component.css']
})
export class IngresosDiaComponent implements OnInit, OnDestroy {
  private inventario = inject(InventarioService);
  private socket     = inject(SocketService);
  private impresion  = inject(ImpresionService);
  private ajustes    = inject(AjustesService);

  readonly idSucursal     = input.required<number>();
  readonly nombreSucursal = input('');
  readonly cerrar         = output<void>();

  readonly icons = { cerrar: X, ticket: Printer };
  readonly hoy   = hoy();

  readonly fecha    = signal(hoy());
  readonly vista    = signal<'productos' | 'detalle'>('productos');
  readonly ingresos = signal<IngresoDia[]>([]);
  readonly estado   = signal<'cargando' | 'listo' | 'error'>('cargando');
  private zonaTicket = viewChild<ElementRef<HTMLElement>>('zonaTicket');
  private sub?: Subscription;
  private recarga?: ReturnType<typeof setTimeout>;

  /** Por categoría (orden del menú) y producto, con el total del día */
  readonly grupos = computed<GrupoIngresos[]>(() => {
    const cats = new Map<number, GrupoIngresos & { mapa: Map<number, FilaProducto> }>();
    for (const m of this.ingresos()) {
      const idCat = m.id_categoria ?? 0;
      const g = cats.get(idCat) ?? { id: idCat, categoria: m.nombre_categoria || 'SIN CATEGORÍA', orden: m.orden_categoria, productos: [], mapa: new Map() };
      const p = g.mapa.get(m.id_producto) ?? { id_producto: m.id_producto, nombre_producto: m.nombre_producto, cantidad: 0, entradas: 0, ultima: m.fecha_registro };
      p.cantidad += m.cantidad_movida;
      p.entradas++;
      if (m.fecha_registro > p.ultima) p.ultima = m.fecha_registro;
      g.mapa.set(m.id_producto, p);
      cats.set(idCat, g);
    }
    return [...cats.values()]
      .sort((a, b) => a.orden - b.orden || a.categoria.localeCompare(b.categoria))
      .map(({ mapa, ...g }) => ({ ...g, productos: [...mapa.values()].sort((a, b) => a.nombre_producto.localeCompare(b.nombre_producto)) }));
  });

  readonly totales = computed(() => ({
    productos: this.grupos().reduce((s, g) => s + g.productos.length, 0),
    unidades:  this.ingresos().reduce((s, m) => s + m.cantidad_movida, 0)
  }));

  readonly gruposTicket = computed<GrupoListaDia[]>(() =>
    this.grupos().map(g => ({ categoria: g.categoria, items: g.productos })));

  readonly fechaTexto = computed(() => fechaLarga(this.fecha()));

  ngOnInit() {
    this.cargar();
    this.socket.conectar('cajeros');
    // Cada entrada nueva de la sucursal llega como cambio de stock: se recarga si se mira el día de hoy
    this.sub = this.socket.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (Number(p?.id_sucursal) !== this.idSucursal() || this.fecha() !== hoy()) return;
      clearTimeout(this.recarga);
      this.recarga = setTimeout(() => this.cargar(), 500);
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); clearTimeout(this.recarga); }

  cargar() {
    this.inventario.ingresosDia(this.idSucursal(), this.fecha()).subscribe({
      next:  (l) => { this.ingresos.set(l); this.estado.set('listo'); },
      error: () => this.estado.set('error')
    });
  }

  cambiarFecha(valor: string) {
    if (!valor || valor === this.fecha()) return;
    this.fecha.set(valor > this.hoy ? this.hoy : valor);
    this.estado.set('cargando');
    this.cargar();
  }

  imprimirTicket() {
    if (!this.totales().unidades) return;
    requestAnimationFrame(() => this.impresion.imprimirTicket(this.zonaTicket()?.nativeElement, this.ajustes.config().ticket_ancho));
  }
}
