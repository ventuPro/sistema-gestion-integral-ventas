import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LucideAngularModule, X, Printer } from 'lucide-angular';
import { InventarioService, IngresoDia } from '../../../../core/services/inventario.service';
import { SocketService } from '../../../../core/services/socket.service';
import { fechaDia, fechaLarga } from '../../../../core/utils/informe';
import { GrupoListaDia, TicketListaDiaComponent } from '../../../shared/ticket/ticket-lista-dia.component';
import { VistaTicketComponent } from '../../../shared/ticket/vista-ticket.component';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

interface FilaProducto { id_producto: number; nombre_producto: string; cantidad: number; entradas: number; ultima: string;
                         repartido: Record<number, number>; quedo: number }
interface GrupoIngresos { id: number; categoria: string; orden: number; productos: FilaProducto[] }

const hoy = () => new Date().toLocaleDateString('en-CA');   // AAAA-MM-DD en hora local

// ─── Inventario → «Ingresos del día»: lo que se produjo o llegó, por producto y en detalle ───
@Component({
  selector: 'app-ingresos-dia',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, LucideAngularModule, TicketListaDiaComponent, VistaTicketComponent],
  templateUrl: './ingresos-dia.component.html',
  styleUrls: ['../../../shared/informe/informe.css', './ingresos-dia.component.css']
})
export class IngresosDiaComponent implements OnInit, OnDestroy {
  private inventario = inject(InventarioService);
  private socket     = inject(SocketService);

  readonly idSucursal     = input.required<number>();
  readonly nombreSucursal = input('');
  readonly cerrar         = output<void>();

  readonly icons = { cerrar: X, ticket: Printer };
  readonly hoy   = hoy();

  readonly fecha    = signal(hoy());
  readonly vista    = signal<'productos' | 'detalle'>('productos');
  readonly ingresos = signal<IngresoDia[]>([]);
  readonly estado   = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly verTicket = signal(false);
  private sub?: Subscription;
  private recarga?: ReturnType<typeof setTimeout>;

  /** Por categoría (orden del menú) y producto, con el total del día */
  readonly grupos = computed<GrupoIngresos[]>(() => {
    const cats = new Map<number, GrupoIngresos & { mapa: Map<number, FilaProducto> }>();
    for (const m of this.ingresos()) {
      const idCat = m.id_categoria ?? 0;
      const g = cats.get(idCat) ?? { id: idCat, categoria: m.nombre_categoria || 'SIN CATEGORÍA', orden: m.orden_categoria, productos: [], mapa: new Map() };
      const p = g.mapa.get(m.id_producto) ?? { id_producto: m.id_producto, nombre_producto: m.nombre_producto, cantidad: 0, entradas: 0,
                                               ultima: m.fecha_registro, repartido: {}, quedo: 0 };
      p.cantidad += m.cantidad_movida;
      p.quedo += m.cantidad_movida;
      for (const r of m.repartido || []) {
        p.repartido[r.id_sucursal] = (p.repartido[r.id_sucursal] || 0) + r.cantidad;
        p.quedo -= r.cantidad;
      }
      p.entradas++;
      if (m.fecha_registro > p.ultima) p.ultima = m.fecha_registro;
      g.mapa.set(m.id_producto, p);
      cats.set(idCat, g);
    }
    return [...cats.values()]
      .sort((a, b) => a.orden - b.orden || a.categoria.localeCompare(b.categoria))
      .map(({ mapa, ...g }) => ({ ...g, productos: [...mapa.values()].sort((a, b) => a.nombre_producto.localeCompare(b.nombre_producto)) }));
  });

  /** Sucursales a las que se repartió en el día (una columna por cada una) */
  readonly destinos = computed(() => {
    const m = new Map<number, string>();
    for (const i of this.ingresos()) for (const r of i.repartido || []) m.set(r.id_sucursal, r.nombre_sucursal);
    return [...m].sort((a, b) => a[0] - b[0]).map(([id_sucursal, nombre_sucursal]) => ({ id_sucursal, nombre_sucursal }));
  });

  readonly totales = computed(() => ({
    productos: this.grupos().reduce((s, g) => s + g.productos.length, 0),
    unidades:  this.ingresos().reduce((s, m) => s + m.cantidad_movida, 0),
    repartidas: this.ingresos().reduce((s, m) => s + (m.repartido || []).reduce((t, r) => t + r.cantidad, 0), 0)
  }));

  readonly gruposTicket = computed<GrupoListaDia[]>(() => {
    const destinos = this.destinos();
    return this.grupos().map(g => ({
      categoria: g.categoria,
      items: g.productos.map(p => ({
        nombre_producto: p.nombre_producto, cantidad: p.cantidad,
        detalle: destinos.some(d => p.repartido[d.id_sucursal])
          ? [...destinos.filter(d => p.repartido[d.id_sucursal]).map(d => `${d.nombre_sucursal}: ${p.repartido[d.id_sucursal]}`),
             `Quedó: ${p.quedo}`].join(' · ')
          : undefined
      }))
    }));
  });

  textoReparto(m: IngresoDia): string {
    return (m.repartido || []).map(r => `${r.nombre_sucursal}: ${r.cantidad}`).join(' · ');
  }

  readonly fechaTexto = computed(() => fechaLarga(this.fecha()));
  readonly fechaTicket = computed(() => fechaDia(this.fecha()));

  ngOnInit() {
    this.cargar();
    this.socket.conectar('cajeros');
    // Cada entrada nueva de la sucursal llega como cambio de stock: se recarga si se mira el día de hoy
    this.sub = this.socket.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (Number(p?.id_sucursal) !== this.idSucursal() || this.fecha() !== hoy()) return;
      clearTimeout(this.recarga);
      this.recarga = setTimeout(() => this.cargar(), 500);
    });
    // Tras un corte de conexión: lo que entró mientras tanto
    this.sub.add(this.socket.reconexiones.subscribe(() => this.cargar()));
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

  abrirTicket() {
    if (this.totales().unidades) this.verTicket.set(true);
  }
}
