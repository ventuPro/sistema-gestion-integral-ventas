import { Component, ElementRef, computed, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, merge } from 'rxjs';
import { LucideAngularModule, Plus, Pencil, Trash2, X, Search, ChevronLeft, ChevronRight, Printer, PackageCheck,
         Undo2, CalendarDays, List, Sparkles, Phone, MapPin, Store } from 'lucide-angular';
import { Encargo, EncargoService, LineaEncargo, TIPOS_EVENTO, estadoPago } from '../../../core/services/encargo.service';
import { ProductoService } from '../../../core/services/producto.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';
import { SocketService } from '../../../core/services/socket.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { ImpresionService } from '../../../core/services/impresion.service';
import { ComprobanteEncargoComponent } from '../../shared/ticket/comprobante-encargo.component';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { cifra, fechaDia, fechaLarga } from '../../../core/utils/informe';

type Vista = 'calendario' | 'lista';
type FiltroLista = 'pendientes' | 'hoy' | 'semana' | 'entregados' | 'todos';
type ModoPago = 'entregar' | 'adelanto' | 'todo';

interface DiaCalendario { fecha: string; numero: number; delMes: boolean; hoy: boolean; encargos: Encargo[] }

const CLAVE_VISTA = 'encargos_vista';
const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** AAAA-MM-DD en hora local */
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const hoyISO = (dias = 0) => { const d = new Date(); d.setDate(d.getDate() + dias); return iso(d); };

// ─── Encargos para eventos ───
@Component({
  selector: 'app-encargos',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent,
            ComprobanteEncargoComponent, FondoModalDirective],
  templateUrl: './encargos.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './encargos.component.css']
})
export class EncargosComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private servicio        = inject(EncargoService);
  private productoService = inject(ProductoService);
  private sucursalService = inject(SucursalService);
  private dialogo         = inject(DialogoService);
  private socket          = inject(SocketService);
  private impresion       = inject(ImpresionService);
  private ajustes         = inject(AjustesService);
  readonly moneda         = this.ajustes.moneda;

  readonly icons = { nuevo: Plus, editar: Pencil, eliminar: Trash2, cerrar: X, buscar: Search, antes: ChevronLeft,
                     despues: ChevronRight, imprimir: Printer, entregar: PackageCheck, deshacer: Undo2,
                     calendario: CalendarDays, lista: List, personalizado: Sparkles, celular: Phone, domicilio: MapPin,
                     sucursal: Store };
  readonly cifra = cifra;
  readonly fechaDia = fechaDia;
  readonly estadoPago = estadoPago;
  readonly TIPOS_EVENTO = TIPOS_EVENTO;
  readonly DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  readonly filtros: { valor: FiltroLista; texto: string }[] = [
    { valor: 'pendientes', texto: 'Por entregar' }, { valor: 'hoy', texto: 'Hoy' }, { valor: 'semana', texto: 'Próximos 7 días' },
    { valor: 'entregados', texto: 'Entregados' }, { valor: 'todos', texto: 'Todos' }
  ];

  readonly esAdmin        = this.sesion.esAdmin;
  readonly sucursales     = signal<any[]>([]);
  readonly sucursalFiltro = signal<number | null>(null);   // administrador: null = todas
  readonly vista          = signal<Vista>(this.leerVista());
  readonly cargando       = signal(true);

  // ─── Calendario ───
  readonly mes         = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly delMes      = signal<Encargo[]>([]);
  readonly diaElegido  = signal(hoyISO());
  readonly tituloMes   = computed(() => `${NOMBRES_MES[this.mes().getMonth()]} ${this.mes().getFullYear()}`);

  /** Semanas que se ven (de lunes a domingo, con los días del mes anterior y siguiente) */
  private readonly rango = computed(() => {
    const primero = this.mes();
    const inicio = new Date(primero);
    inicio.setDate(1 - ((primero.getDay() + 6) % 7));
    const ultimo = new Date(primero.getFullYear(), primero.getMonth() + 1, 0);
    const fin = new Date(ultimo);
    fin.setDate(ultimo.getDate() + (6 - ((ultimo.getDay() + 6) % 7)));
    return { inicio, fin };
  });

  readonly dias = computed<DiaCalendario[]>(() => {
    const { inicio, fin } = this.rango();
    const porDia = new Map<string, Encargo[]>();
    for (const e of this.delMes()) porDia.set(e.fecha, [...(porDia.get(e.fecha) || []), e]);
    const hoy = hoyISO(), mes = this.mes().getMonth(), lista: DiaCalendario[] = [];
    for (const d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const fecha = iso(d);
      lista.push({ fecha, numero: d.getDate(), delMes: d.getMonth() === mes, hoy: fecha === hoy, encargos: porDia.get(fecha) || [] });
    }
    return lista;
  });

  readonly encargosDelDia = computed(() => this.delMes().filter(e => e.fecha === this.diaElegido()));
  readonly tituloDia = computed(() => fechaLarga(this.diaElegido()));

  // ─── Lista ───
  readonly filtro   = signal<FiltroLista>('pendientes');
  readonly busqueda = signal('');
  readonly enLista  = signal<Encargo[]>([]);
  readonly lista = computed(() => {
    const t = this.busqueda().trim().toLowerCase();
    const l = this.enLista().filter(e => !t || e.nombre_cliente.toLowerCase().includes(t) || e.celular_cliente.includes(t)
      || String(e.id_encargo) === t.replace('#', ''));
    return this.filtro() === 'entregados' || this.filtro() === 'todos' ? [...l].reverse() : l;
  });

  // ─── Detalle (ticket) ───
  readonly detalle = signal<Encargo | null>(null);
  private zonaTicket = viewChild<ElementRef<HTMLElement>>('zonaTicket');

  imprimir() { this.impresion.imprimirTicket(this.zonaTicket()?.nativeElement, this.ajustes.config().ticket_ancho); }

  // ─── Formulario ───
  readonly modalAbierto    = signal(false);
  readonly formulario      = signal<Encargo>(this.vacio());
  readonly modoPago        = signal<ModoPago>('entregar');
  readonly guardando       = signal(false);
  readonly errorFormulario = signal('');
  readonly productos       = signal<any[]>([]);
  readonly buscaProducto   = signal('');
  /** Se recalcula al editar líneas (sus campos cambian dentro del objeto actual) */
  readonly version         = signal(0);

  readonly resultados = computed(() => {
    const t = this.buscaProducto().trim().toLowerCase();
    if (!t) return [];
    return this.productos().filter(p => p.nombre_producto.toLowerCase().includes(t)).slice(0, 8);
  });

  readonly total = computed(() => {
    this.version();
    return Math.round(this.formulario().items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0), 0) * 100) / 100;
  });

  private subs: Subscription[] = [];
  private recarga?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    if (this.esAdmin())
      this.sucursalService.listarSucursales().subscribe({ next: (s: any[]) => this.sucursales.set((s || []).filter((x: any) => x.estado_activo !== false)) });
    this.productoService.obtenerInventario(this.sesion.idSucursal() || 1).subscribe({
      next: (p) => this.productos.set((p || []).map(x => ({ ...x, precio_unitario: Number(x.precio_unitario) })))
    });
    this.cargar();
    this.socket.conectar('cajeros');
    this.subs.push(merge(this.socket.escuchar<any>('encargos:actualizados'), this.socket.reconexiones).subscribe(() => {
      clearTimeout(this.recarga);
      this.recarga = setTimeout(() => this.cargar(), 300);
    }));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    clearTimeout(this.recarga);
  }

  private leerVista(): Vista {
    try { return localStorage.getItem(CLAVE_VISTA) === 'lista' ? 'lista' : 'calendario'; } catch { return 'calendario'; }
  }

  cambiarVista(v: Vista) {
    this.vista.set(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch { }
    this.cargar();
  }

  cambiarSucursal(id: number | null) {
    this.sucursalFiltro.set(id);
    this.cargar();
  }

  cargar() {
    const id_sucursal = this.sucursalFiltro();
    if (this.vista() === 'calendario') {
      const { inicio, fin } = this.rango();
      this.servicio.listar({ id_sucursal, desde: iso(inicio), hasta: iso(fin) }).subscribe({
        next: (l) => { this.delMes.set(l); this.cargando.set(false); },
        error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar los encargos.'); }
      });
      return;
    }
    const f = this.filtro();
    const filtro = {
      pendientes: { estado: 'Recibido' as const },
      hoy:        { desde: hoyISO(), hasta: hoyISO() },
      semana:     { desde: hoyISO(), hasta: hoyISO(7), estado: 'Recibido' as const },
      entregados: { desde: hoyISO(-90), estado: 'Entregado' as const },
      todos:      { desde: hoyISO(-90) }
    }[f];
    this.servicio.listar({ id_sucursal, ...filtro }).subscribe({
      next: (l) => { this.enLista.set(l); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar los encargos.'); }
    });
  }

  cambiarFiltro(f: FiltroLista) {
    this.filtro.set(f);
    this.cargar();
  }

  moverMes(delta: number) {
    const m = this.mes();
    this.mes.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
    this.cargar();
  }

  irAHoy() {
    const h = new Date();
    this.mes.set(new Date(h.getFullYear(), h.getMonth(), 1));
    this.diaElegido.set(hoyISO());
    this.cargar();
  }

  elegirDia(d: DiaCalendario) {
    this.diaElegido.set(d.fecha);
    if (!d.delMes) this.moverMes(d.fecha < iso(this.mes()) ? -1 : 1);
  }

  resumenItems(e: Encargo): string {
    return e.items.map(i => `${i.cantidad} ${i.descripcion}`).join(', ');
  }

  claseEncargo(e: Encargo): string {
    return e.estado === 'Entregado' ? 'entregado' : e.atrasado ? 'atrasado' : 'pendiente';
  }

  // ─── Detalle ───
  ver(e: Encargo) { this.detalle.set(e); }

  async entregar(e: Encargo) {
    const saldo = Number(e.saldo) || 0;
    if (!(await this.dialogo.confirmar({
      titulo: `¿Entregar el encargo #${e.id_encargo}?`,
      mensaje: saldo > 0 ? `${e.nombre_cliente} paga el saldo de ${this.moneda()} ${cifra(saldo)}.` : `${e.nombre_cliente} ya pagó todo.`,
      textoConfirmar: 'Entregado'
    }))) return;
    this.cambiarEstado(e, true);
  }

  async deshacerEntrega(e: Encargo) {
    if (!(await this.dialogo.confirmar({
      titulo: `¿Deshacer la entrega del encargo #${e.id_encargo}?`, mensaje: 'Vuelve a quedar por entregar.', textoConfirmar: 'Deshacer'
    }))) return;
    this.cambiarEstado(e, false);
  }

  private cambiarEstado(e: Encargo, entregado: boolean) {
    this.servicio.cambiarEstado(e.id_encargo!, entregado).subscribe({
      next: (r) => { this.dialogo.avisar(r.mensaje); this.detalle.set(r.encargo); this.cargar(); },
      error: (x) => this.dialogo.error(x?.error?.error || 'No se pudo cambiar el estado.')
    });
  }

  async eliminar(e: Encargo) {
    if (!(await this.dialogo.confirmar({
      titulo: `¿Eliminar el encargo #${e.id_encargo}?`, mensaje: `${e.nombre_cliente} · ${fechaDia(e.fecha)} ${e.hora}. Esta acción no se puede deshacer.`,
      textoConfirmar: 'Eliminar', peligro: true
    }))) return;
    this.servicio.eliminar(e.id_encargo!).subscribe({
      next: (r) => { this.dialogo.avisar(r.mensaje); this.detalle.set(null); this.cargar(); },
      error: (x) => this.dialogo.error(x?.error?.error || 'No se pudo eliminar el encargo.')
    });
  }

  // ─── Crear / editar ───
  private vacio(fecha = hoyISO(1)): Encargo {
    return {
      id_sucursal: this.sesion?.esAdmin() ? (this.sucursalFiltro?.() ?? null) : this.sesion?.idSucursal() ?? null,
      nombre_cliente: '', celular_cliente: '', tipo_evento: 'CUMPLEAÑOS', fecha, hora: '10:00',
      a_domicilio: false, direccion_entrega: null, observaciones: null, adelanto: null, items: []
    };
  }

  abrirNuevo() {
    const elegido = this.vista() === 'calendario' && this.diaElegido() >= hoyISO() ? this.diaElegido() : hoyISO(1);
    const f = this.vacio(elegido);
    if (this.esAdmin() && !f.id_sucursal && this.sucursales().length === 1) f.id_sucursal = this.sucursales()[0].id_sucursal;
    this.abrir(f, 'entregar');
  }

  editar(e: Encargo) {
    const adelanto = Number(e.adelanto) || 0;
    const modo: ModoPago = adelanto <= 0 ? 'entregar' : adelanto >= Number(e.total) ? 'todo' : 'adelanto';
    this.detalle.set(null);
    this.abrir({ ...e, adelanto: modo === 'adelanto' ? adelanto : null, items: e.items.map(i => ({ ...i })) }, modo);
  }

  private abrir(f: Encargo, modo: ModoPago) {
    this.formulario.set(f);
    this.modoPago.set(modo);
    this.errorFormulario.set('');
    this.buscaProducto.set('');
    this.modalAbierto.set(true);
  }

  cerrarModal() { if (!this.guardando()) this.modalAbierto.set(false); }

  agregarProducto(p: any) {
    this.formulario.update(f => ({
      ...f, items: [...f.items, { id_producto: p.id_producto, descripcion: p.nombre_producto, detalle: null, cantidad: 1, precio_unitario: p.precio_unitario }]
    }));
    this.buscaProducto.set('');
  }

  agregarPersonalizado() {
    this.formulario.update(f => ({
      ...f, items: [...f.items, { id_producto: null, descripcion: '', personalizado: true, detalle: null, cantidad: 1, precio_unitario: null }]
    }));
  }

  /** Enter en el buscador agrega el primero que coincide (no envía el formulario) */
  agregarPrimero(evento: Event) {
    const p = this.resultados()[0];
    if (!p) return;
    evento.preventDefault();
    this.agregarProducto(p);
  }

  quitarLinea(n: number) {
    this.formulario.update(f => ({ ...f, items: f.items.filter((_, i) => i !== n) }));
  }

  esPersonalizado(l: LineaEncargo) { return !l.id_producto; }

  cambiarDomicilio(valor: boolean) {
    this.formulario.update(f => ({ ...f, a_domicilio: valor, direccion_entrega: valor ? f.direccion_entrega : null }));
  }

  guardar() {
    const f = this.formulario();
    if (!f.items.length) return this.errorFormulario.set('Agrega al menos un producto.');
    if (this.esAdmin() && !f.id_sucursal) return this.errorFormulario.set('Elige la sucursal.');
    const total = this.total(), modo = this.modoPago();
    const adelanto = modo === 'todo' ? total : modo === 'adelanto' ? Number(f.adelanto) || 0 : 0;
    if (modo === 'adelanto' && !(adelanto > 0)) return this.errorFormulario.set('Escribe el monto del adelanto.');
    if (adelanto > total) return this.errorFormulario.set('El adelanto no puede ser mayor que el total.');

    this.guardando.set(true);
    this.errorFormulario.set('');
    this.servicio.guardar({ ...f, adelanto }).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.modalAbierto.set(false);
        this.dialogo.avisar(r.mensaje);
        // Al registrarlo se muestra el ticket para imprimirlo
        this.detalle.set(r.encargo);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorFormulario.set(e?.error?.error || 'No se pudo guardar el encargo.');
      }
    });
  }
}
