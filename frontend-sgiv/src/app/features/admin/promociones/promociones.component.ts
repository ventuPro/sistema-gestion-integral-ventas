import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, Trash2, X, Search, Power, Lock, Percent, Tag, Gift, PackagePlus,
         Minus } from 'lucide-angular';
import { Promocion, PromocionService, TipoPromocion } from '../../../core/services/promocion.service';
import { ProductoService } from '../../../core/services/producto.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { cifra, entero, fechaCorta } from '../../../core/utils/informe';
import { BarraCategoriasComponent } from '../../shared/barra-categorias/barra-categorias.component';
import { agruparPorCategoria } from '../../../core/utils/categorias';

type Filtro = 'vigentes' | 'activas' | 'inactivas' | 'todas';

const DIAS = [
  { n: 1, texto: 'Lun' }, { n: 2, texto: 'Mar' }, { n: 3, texto: 'Mié' }, { n: 4, texto: 'Jue' },
  { n: 5, texto: 'Vie' }, { n: 6, texto: 'Sáb' }, { n: 7, texto: 'Dom' }
];

const hoyISO = (dias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');   // AAAA-MM-DD en hora local
};

// ─── Promociones ───
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent, BarraCategoriasComponent],
  templateUrl: './promociones.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './promociones.component.css']
})
export class PromocionesComponent implements OnInit {
  private readonly sesion = inject(SesionService);
  private servicio        = inject(PromocionService);
  private productoService = inject(ProductoService);
  private sucursalService = inject(SucursalService);
  private dialogo         = inject(DialogoService);
  readonly moneda         = inject(AjustesService).moneda;

  readonly icons = { nueva: Plus, editar: Pencil, eliminar: Trash2, cerrar: X, buscar: Search, estado: Power,
                     bloqueada: Lock, menos: Minus, mas: Plus };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly DIAS = DIAS;
  readonly tipos: { valor: TipoPromocion; nombre: string; icono: any }[] = [
    { valor: 'PORCENTAJE', nombre: 'Porcentaje',      icono: Percent },
    { valor: 'PRECIO',     nombre: 'Precio especial', icono: Tag },
    { valor: 'NXM',        nombre: 'Lleva N, paga M', icono: Gift },
    { valor: 'COMBO',      nombre: 'Combo',           icono: PackagePlus }
  ];
  readonly filtros: { valor: Filtro; texto: string }[] = [
    { valor: 'vigentes', texto: 'Vigentes ahora' }, { valor: 'activas', texto: 'Activas' },
    { valor: 'inactivas', texto: 'Inactivas' }, { valor: 'todas', texto: 'Todas' }
  ];

  readonly esAdmin = this.sesion.esAdmin;
  readonly promociones    = signal<Promocion[]>([]);
  readonly cargando       = signal(true);
  readonly sucursales     = signal<any[]>([]);
  readonly sucursalFiltro = signal<number | null>(null);   // administrador: null = todas
  readonly filtro         = signal<Filtro>('activas');
  readonly busqueda       = signal('');
  readonly productos      = signal<any[]>([]);
  readonly categorias     = signal<any[]>([]);

  readonly lista = computed(() => {
    const texto = this.busqueda().trim().toLowerCase(), f = this.filtro();
    return this.promociones().filter(p =>
      (f === 'todas' || (f === 'vigentes' && p.vigente) || (f === 'activas' && p.estado_activo) || (f === 'inactivas' && !p.estado_activo)) &&
      (!texto || p.nombre.toLowerCase().includes(texto)));
  });

  readonly resumen = computed(() => {
    const hoy = hoyISO(), lista = this.promociones();
    return {
      vigentes:    lista.filter(p => p.vigente).length,
      programadas: lista.filter(p => p.estado_activo && !p.vigente && p.fecha_fin >= hoy).length,
      usos:        lista.reduce((s, p) => s + (p.usos || 0), 0),
      ahorro:      lista.reduce((s, p) => s + (p.ahorro || 0), 0)
    };
  });

  // ─── Formulario: se reemplaza con set(); el template edita los campos simples del objeto actual ───
  readonly modalAbierto    = signal(false);
  readonly formulario      = signal<Promocion>(this.vacia());
  readonly guardando       = signal(false);
  readonly errorFormulario = signal('');
  readonly buscaProducto   = signal('');

  readonly productosModal = computed(() => {
    const texto = this.buscaProducto().trim().toLowerCase();
    return this.productos().filter(p => !texto || p.nombre_producto.toLowerCase().includes(texto));
  });

  /** Para elegir productos: por categoría, en el orden del menú */
  readonly seccionesModal = computed(() => agruparPorCategoria(this.productosModal(), { stockPrimero: false }));
  readonly barraModal = computed(() => this.seccionesModal().map(s => ({ id: s.id, nombre: s.nombre, icono: s.icono, cantidad: s.productos.length })));

  ngOnInit() {
    if (this.esAdmin())
      this.sucursalService.listarSucursales().subscribe({ next: (s: any[]) => this.sucursales.set(s || []) });
    this.productoService.obtenerInventario(this.sesion.idSucursal()).subscribe({
      next: (p) => this.productos.set((p || []).map(x => ({ ...x, precio_unitario: Number(x.precio_unitario) })))
    });
    this.productoService.obtenerCategorias().subscribe({ next: (c) => this.categorias.set(c || []) });
    this.cargar();
  }

  cargar() {
    this.servicio.listar(this.sucursalFiltro()).subscribe({
      next: (l) => { this.promociones.set(l); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar las promociones.'); }
    });
  }

  cambiarSucursal(id: number | null) {
    this.sucursalFiltro.set(id);
    this.cargar();
  }

  // ─── Textos de la lista ───
  estado(p: Promocion): { texto: string; clase: string } {
    if (!p.estado_activo) return { texto: 'Inactiva', clase: 'neutro' };
    if (p.vigente) return { texto: 'Vigente ahora', clase: 'ok' };
    if (p.fecha_fin < hoyISO()) return { texto: 'Vencida', clase: 'mal' };
    return { texto: 'Programada', clase: 'aviso' };
  }

  textoTipo(p: Promocion): string {
    if (p.tipo === 'PORCENTAJE') return `−${+p.valor} %`;
    if (p.tipo === 'PRECIO') return `${this.moneda()} ${cifra(p.valor)} c/u`;
    if (p.tipo === 'NXM') return `${p.lleva}×${p.paga}`;
    return `Combo ${this.moneda()} ${cifra(p.valor)}`;
  }

  textoAlcance(p: Promocion): string {
    const prods = p.productos.map(x => (p.tipo === 'COMBO' && x.cantidad > 1 ? `${x.cantidad}× ` : '') + (x.nombre_producto || ''));
    const cats = p.categorias.map(c => c.nombre_categoria || '');
    return [...cats, ...prods].join(', ');
  }

  textoVigencia(p: Promocion): string {
    const fechas = p.fecha_inicio === p.fecha_fin ? fechaCorta(p.fecha_inicio) : `${fechaCorta(p.fecha_inicio)} – ${fechaCorta(p.fecha_fin)}`;
    const dias = p.dias_semana?.length ? DIAS.filter(d => p.dias_semana!.includes(d.n)).map(d => d.texto).join(' ') : '';
    const horas = p.hora_inicio ? `${p.hora_inicio}–${p.hora_fin}` : '';
    return [fechas, dias, horas].filter(Boolean).join(' · ');
  }

  // ─── Crear / editar ───
  private vacia(): Promocion {
    return {
      nombre: '', tipo: 'PORCENTAJE', valor: 10, lleva: null, paga: null,
      id_sucursal: this.sesion?.esAdmin() ? null : this.sesion?.idSucursal() ?? null,
      fecha_inicio: hoyISO(), fecha_fin: hoyISO(30), dias_semana: null, hora_inicio: null, hora_fin: null,
      estado_activo: true, productos: [], categorias: []
    };
  }

  abrirNueva() { this.abrir(this.vacia()); }

  abrirEdicion(p: Promocion) {
    this.abrir({ ...p, productos: p.productos.map(x => ({ ...x })), categorias: p.categorias.map(c => ({ ...c })),
                 dias_semana: p.dias_semana ? [...p.dias_semana] : null });
  }

  private abrir(p: Promocion) {
    this.formulario.set(p);
    this.errorFormulario.set('');
    this.buscaProducto.set('');
    this.modalAbierto.set(true);
  }

  cerrarModal() { if (!this.guardando()) this.modalAbierto.set(false); }

  cambiarTipo(tipo: TipoPromocion) {
    this.formulario.update(f => ({
      ...f, tipo,
      valor: tipo === 'PORCENTAJE' ? 10 : tipo === 'NXM' ? 0 : f.tipo === tipo ? f.valor : 0,
      lleva: tipo === 'NXM' ? (f.lleva ?? 3) : null,
      paga:  tipo === 'NXM' ? (f.paga ?? 2) : null,
      categorias: tipo === 'COMBO' || tipo === 'PRECIO' ? [] : f.categorias,
      productos:  f.productos.map(x => ({ ...x, cantidad: tipo === 'COMBO' ? x.cantidad : 1 }))
    }));
  }

  /** Los precios especiales y los combos van por producto; el resto también admite categorías */
  get usaCategorias(): boolean { return this.formulario().tipo === 'PORCENTAJE' || this.formulario().tipo === 'NXM'; }

  tieneProducto(id: number): boolean { return this.formulario().productos.some(x => x.id_producto === id); }

  alternarProducto(prod: any) {
    this.formulario.update(f => ({
      ...f,
      productos: this.tieneProducto(prod.id_producto)
        ? f.productos.filter(x => x.id_producto !== prod.id_producto)
        : [...f.productos, { id_producto: prod.id_producto, cantidad: 1, nombre_producto: prod.nombre_producto, precio_unitario: prod.precio_unitario }]
    }));
  }

  cambiarCantidad(id: number, delta: number) {
    this.formulario.update(f => ({
      ...f, productos: f.productos.map(x => x.id_producto === id ? { ...x, cantidad: Math.min(50, Math.max(1, x.cantidad + delta)) } : x)
    }));
  }

  tieneCategoria(id: number): boolean { return this.formulario().categorias.some(c => c.id_categoria === id); }

  alternarCategoria(cat: any) {
    this.formulario.update(f => ({
      ...f,
      categorias: this.tieneCategoria(cat.id_categoria)
        ? f.categorias.filter(c => c.id_categoria !== cat.id_categoria)
        : [...f.categorias, { id_categoria: cat.id_categoria, nombre_categoria: cat.nombre_categoria }]
    }));
  }

  diaActivo(n: number): boolean { return !this.formulario().dias_semana || this.formulario().dias_semana!.includes(n); }

  alternarDia(n: number) {
    this.formulario.update(f => {
      const actuales = f.dias_semana ?? DIAS.map(d => d.n);
      const dias = actuales.includes(n) ? actuales.filter(d => d !== n) : [...actuales, n].sort((a, b) => a - b);
      return { ...f, dias_semana: dias.length === 7 ? null : dias };
    });
  }

  alternarHorario() {
    this.formulario.update(f => f.hora_inicio
      ? { ...f, hora_inicio: null, hora_fin: null }
      : { ...f, hora_inicio: '18:00', hora_fin: '21:00' });
  }

  /** Combo: precio normal de sus productos (los cambios de cantidad pasan por update, el precio por ngModel) */
  get precioNormalCombo(): number {
    return this.formulario().productos.reduce((s, x) => s + x.cantidad * (x.precio_unitario ?? this.precioDe(x.id_producto)), 0);
  }

  private precioDe(id: number): number { return Number(this.productos().find(p => p.id_producto === id)?.precio_unitario || 0); }

  guardar() {
    const f = this.formulario();
    if (f.tipo !== 'COMBO' && !f.productos.length && !f.categorias.length)
      return this.errorFormulario.set('Elige al menos un producto o una categoría.');
    this.guardando.set(true);
    this.errorFormulario.set('');
    this.servicio.guardar(f).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.modalAbierto.set(false);
        this.dialogo.avisar(r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorFormulario.set(e?.error?.error || 'No se pudo guardar la promoción.');
      }
    });
  }

  alternarEstado(p: Promocion) {
    this.servicio.cambiarEstado(p.id_promocion!, !p.estado_activo).subscribe({
      next: (r) => { this.dialogo.avisar(r.mensaje); this.cargar(); },
      error: (e) => this.dialogo.error(e?.error?.error || 'No se pudo cambiar el estado.')
    });
  }

  async eliminar(p: Promocion) {
    const si = await this.dialogo.confirmar({
      titulo: `¿Eliminar «${p.nombre}»?`, mensaje: 'Esta acción no se puede deshacer.', textoConfirmar: 'Eliminar', peligro: true
    });
    if (!si) return;
    this.servicio.eliminar(p.id_promocion!).subscribe({
      next: (r) => { this.dialogo.avisar(r.mensaje); this.cargar(); },
      error: (e) => this.dialogo.error(e?.error?.error || 'No se pudo eliminar la promoción.')
    });
  }
}
