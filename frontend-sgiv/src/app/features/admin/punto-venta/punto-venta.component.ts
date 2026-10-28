import { afterNextRender, Component, computed, effect, inject, Injector, OnInit, OnDestroy, signal, untracked, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { CajaService, EstadoCajaCompleto } from '../../../core/services/caja.service';
import { SocketService } from '../../../core/services/socket.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Subscription } from 'rxjs';
import { Cotizacion, DescuentoManual, FormDescuento, PromocionService, PromocionVigente, etiquetaPromocion } from '../../../core/services/promocion.service';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { TicketComponent } from '../../shared/ticket/ticket.component';
import { LucideAngularModule,
         ShieldAlert, Landmark, RefreshCw, Check, Search, X, ReceiptText, Trash2,
         ShoppingCart, Banknote, QrCode, Printer, BadgePercent } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { ImpresionService } from '../../../core/services/impresion.service';
import { sondeo } from '../../../core/utils/sondeo';
import { cifra, fechaLarga } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';
import { METODO_PAGO, MetodoPago } from '../../../core/utils/metodos-pago';
import { SesionService } from '../../../core/services/sesion.service';
import { BarraCategoriasComponent } from '../../shared/barra-categorias/barra-categorias.component';
import { agruparPorCategoria, mejorCoincidencia } from '../../../core/utils/categorias';
import { enfocar, focoOcupado, FondoModalDirective, pantallaTactil } from '../../../core/directives/fondo-modal.directive';

@Component({
  selector: 'app-punto-venta',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, ImagenUrlPipe, TicketComponent, BarraCategoriasComponent],
  templateUrl: './punto-venta.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css', './punto-venta.component.css']
})
export class PuntoVentaComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private productoService = inject(ProductoService);
  private dialogo = inject(DialogoService);
  private cajaService     = inject(CajaService);
  private socketService   = inject(SocketService);
  readonly ajustes         = inject(AjustesService);
  private impresion = inject(ImpresionService);
  private promociones = inject(PromocionService);
  readonly moneda          = this.ajustes.moneda;
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

  private stockSub?: Subscription;
  private cierreSub?: Subscription;

  readonly icons = {
    shieldAlert: ShieldAlert,
    landmark:    Landmark,
    refresh:     RefreshCw,
    check:       Check,
    search:      Search,
    close:       X,
    historial:   ReceiptText,
    quitar:      Trash2,
    carrito:     ShoppingCart,
    efectivo:    Banknote,
    qr:          QrCode,
    imprimir:    Printer,
    descuento:   BadgePercent
  };

  readonly cifra    = cifra;
  readonly hoyTexto = fechaLarga(new Date());

  // ─── Estado de acceso (fuente: backend) ───
  readonly verificandoCaja = signal(true);
  readonly estadoCaja      = signal<EstadoCajaCompleto['estado']>('SIN_APERTURA');
  readonly cierreSistema   = signal<EstadoCajaCompleto['cierre_sistema']>(null);
  readonly puedeVender     = signal(false);

  // ─── Turno ───
  readonly turnoActivo       = signal<any>(null);
  readonly mostrarAbrirTurno = signal(false);   // se muestra cuando SIN_APERTURA
  readonly montoInicial      = signal<number | null>(null);
  readonly abriendoTurno     = signal(false);
  readonly errorTurno        = signal('');

  // ─── Catálogo ───
  readonly productosDisponibles = signal<any[]>([]);
  readonly busqueda             = signal('');
  readonly cargando             = signal(true);

  readonly productosFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    return this.productosDisponibles().filter(p => !q ||
      (p.nombre_producto || '').toLowerCase().includes(q) ||
      (p.nombre_categoria || '').toLowerCase().includes(q));
  });

  /** Por categoría en el orden del menú; los que se agotan pasan al final */
  readonly secciones = computed(() => agruparPorCategoria(this.productosFiltrados()));
  /** El que se agrega con Enter al buscar */
  readonly primero = computed(() => mejorCoincidencia(this.secciones(), this.busqueda()));
  readonly barra = computed(() => this.secciones().map(s => ({ id: s.id, nombre: s.nombre, icono: s.icono, cantidad: s.productos.length })));

  // ─── Carrito ───
  readonly carrito = signal<any[]>([]);

  readonly unidades = computed(() => this.carrito().reduce((s, i) => s + Number(i.cantidad), 0));

  /** A precio de lista */
  readonly subtotal = computed(() =>
    this.carrito().reduce((s, i) => s + (Number(i.precio_unitario) * Number(i.cantidad) || 0), 0));

  // ─── Promociones y descuento manual: el total lo calcula el backend ───
  readonly descuento   = signal<DescuentoManual | null>(null);
  readonly vigentes    = signal<PromocionVigente[]>([]);
  private readonly cotizacionGuardada = signal<{ clave: string; datos: Cotizacion } | null>(null);
  private subCotizacion?: Subscription;
  private esperaCotizacion: any;

  /** Lo que se cotiza: productos, cantidades y descuento */
  private readonly clave = computed(() => JSON.stringify([
    this.carrito().map(i => [i.id_producto, i.cantidad]), this.descuento()
  ]));

  /** La cotización vale solo si corresponde al carrito actual */
  readonly cotizacion = computed(() => {
    const c = this.cotizacionGuardada();
    return c && c.clave === this.clave() ? c.datos : null;
  });
  readonly cotizando = computed(() => this.carrito().length > 0 && !this.cotizacion());
  readonly total = computed(() => this.cotizacion()?.total ?? this.subtotal());

  /** Línea cotizada por producto */
  readonly lineas = computed(() => new Map((this.cotizacion()?.items || []).map(l => [l.id_producto, l])));

  /** Etiqueta de promoción de cada producto del catálogo */
  readonly etiquetas = computed(() => {
    const mapa = new Map<number, string>();
    const vigentes = this.vigentes();
    for (const p of this.productosDisponibles()) {
      const promo = vigentes.find(v => v.productos.includes(p.id_producto) || v.categorias.includes(Number(p.id_categoria)));
      if (promo) mapa.set(p.id_producto, etiquetaPromocion(promo, this.moneda()));
    }
    return mapa;
  });

  // ─── Modal del descuento manual ───
  readonly mostrarDescuento = signal(false);
  readonly formDescuento    = signal<FormDescuento>({ tipo: 'PORCENTAJE', valor: null, motivo: '' });
  readonly errorDescuento   = signal('');
  readonly aplicandoDescuento = signal(false);

  // ─── Modal cobro ───
  readonly mostrarModalCobro = signal(false);
  readonly metodo = METODO_PAGO;
  readonly metodoPago  = signal<MetodoPago>(METODO_PAGO.efectivo);
  readonly montoPagado = signal<number | null>(null);
  /** Monto recibido como número (vacío = 0) */
  readonly pagado      = computed(() => Number(this.montoPagado()) || 0);
  @ViewChild('buscador') buscadorRef?: ElementRef<HTMLInputElement>;
  @ViewChild('inputTurno') inputTurnoRef?: ElementRef<HTMLInputElement>;
  @ViewChild('inputMonto') inputMontoRef?: ElementRef<HTMLInputElement>;
  private readonly injector = inject(Injector);
  @ViewChild('zonaTicket') zonaTicket?: ElementRef<HTMLElement>;
  readonly cambio = computed(() => Math.max(0, this.pagado() - this.total()));

  // ─── Ticket ───
  readonly mostrarTicket = signal(false);
  readonly datosTicket   = signal<any>(null);
  readonly fechaTicket   = signal(new Date());

  // ─── Historial ventas ───
  readonly ventasHoy        = signal<any[]>([]);
  readonly cargandoVentas   = signal(false);
  readonly mostrarHistorial = signal(false);

  // ─── Poll periódico del estado de caja (por si el admin cierra mientras vendemos) ───
  private detenerSondeo?: () => void;

  readonly totalVentasHoy = computed(() => this.ventasHoy().reduce((s, v) => s + Number(v.monto_total_venta), 0));

  readonly metodosHoy = computed(() => {
    const totales = new Map<string, number>();
    for (const v of this.ventasHoy()) totales.set(v.metodo_pago, (totales.get(v.metodo_pago) || 0) + v.monto_total_venta);
    return [...totales].map(([metodo, total]) => ({ metodo, total }));
  });

  constructor() {
    // Cada cambio del carrito o del descuento se vuelve a cotizar (con una espera corta)
    effect(() => {
      const clave = this.clave();
      untracked(() => this.programarCotizacion(clave));
    });
  }

  private detalles() { return this.carrito().map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad })); }

  private programarCotizacion(clave: string) {
    clearTimeout(this.esperaCotizacion);
    this.subCotizacion?.unsubscribe();
    if (!this.carrito().length) return;
    this.esperaCotizacion = setTimeout(() => {
      this.subCotizacion = this.promociones.cotizarVenta(this.detalles(), this.descuento()).subscribe({
        next: (datos) => this.cotizacionGuardada.set({ clave, datos }),
        error: (e) => {
          // El descuento ya no entra en el tope (cambió el carrito): se quita y se avisa
          if (e?.error?.error === 'DESCUENTO_INVALIDO' && this.descuento()) {
            this.descuento.set(null);
            this.dialogo.error(`Se quitó el descuento: ${e.error.detalle}`);
          }
        }
      });
    }, 200);
  }

  ngOnInit() {
    this.verificarAccesoCaja();
    this.suscribirStockGlobal();
  }

  ngOnDestroy() {
    clearTimeout(this.esperaCotizacion);
    this.subCotizacion?.unsubscribe();
    this.detenerSondeo?.();
    this.stockSub?.unsubscribe();
    this.cierreSub?.unsubscribe();
  }

  private suscribirStockGlobal() {
    this.socketService.conectar('cajeros');
    // Cierre automático de las 00:00: se bloquea al instante
    this.cierreSub = this.socketService.escuchar<any>('caja:cerrada').subscribe(d => {
      if (Number(d?.id_usuario) === this.sesion.usuario()?.id_usuario) this.verificarAccesoCaja();
    });
    this.stockSub = this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(payload => {
      if (!payload) return;
      const idSuc = this.sesion.idSucursal();
      if (Number(payload.id_sucursal) !== idSuc) return;

      const idProd = Number(payload.id_producto);
      const nuevo  = Number(payload.nueva_cantidad_disponible) || 0;

      this.productosDisponibles.update(ps => ps.map(p =>
        Number(p.id_producto) === idProd ? { ...p, stock_actual: nuevo } : p));
    });
  }

  // ─── VERIFICACIÓN PRINCIPAL ───
  verificarAccesoCaja() {
    this.verificandoCaja.set(true);

    // Admin y cajero por igual: para vender hay que tener la caja propia abierta
    this.cajaService.obtenerEstadoCompleto().subscribe({
      next: (res) => this.aplicarEstado(res),
      error: () => {
        this.estadoCaja.set('SIN_APERTURA');
        this.puedeVender.set(false);
        this.verificandoCaja.set(false);
        this.cargando.set(false);
      }
    });
  }

  private aplicarEstado(res: EstadoCajaCompleto) {
    this.estadoCaja.set(res.estado);
    this.cierreSistema.set(res.cierre_sistema ?? null);
    this.puedeVender.set(res.puede_vender);
    this.turnoActivo.set(res.turno);
    this.verificandoCaja.set(false);

    if (res.estado === 'ABIERTA') {
      this.mostrarAbrirTurno.set(false);
      this.cargarCatalogo();
      this.cargarVentasHoy();
      this.iniciarPollEstado();
    } else if (res.estado === 'SIN_APERTURA') {
      // Apertura automática del día — mostrar modal para monto inicial
      this.mostrarAbrirTurno.set(true);
      this.cargando.set(false);
      this.enfocarCampo(() => this.inputTurnoRef?.nativeElement);
    } else {
      // CERRADA — bloquear y mostrar mensaje al cajero
      this.mostrarAbrirTurno.set(false);
      this.cargando.set(false);
    }
  }

  private iniciarPollEstado() {
    this.detenerSondeo?.();
    // Cada 30s reverificar — si el admin cierra desde Usuarios, bloqueamos rápido
    this.detenerSondeo = sondeo(() => {
      this.cajaService.obtenerEstadoCompleto().subscribe({
        next: (res) => {
          if (res.estado !== this.estadoCaja()) this.aplicarEstado(res);
        }
      });
    }, 30000);
  }

  // ─── APERTURA AUTOMÁTICA DIARIA ───
  confirmarAbrirTurno() {
    if ((this.montoInicial() ?? 0) < 0) return this.errorTurno.set('Monto inválido.');
    this.abriendoTurno.set(true);
    this.errorTurno.set('');

    this.cajaService.abrirTurno({
      id_sucursal:   this.sesion.idSucursal(),
      monto_inicial: Number(this.montoInicial()) || 0
    }).subscribe({
      next: (res) => {
        this.turnoActivo.set(res.turno);
        this.estadoCaja.set('ABIERTA');
        this.puedeVender.set(true);
        this.mostrarAbrirTurno.set(false);
        this.abriendoTurno.set(false);
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.iniciarPollEstado();
      },
      error: (e: any) => {
        this.errorTurno.set(e?.error?.error || 'Error al abrir el turno.');
        this.abriendoTurno.set(false);
      }
    });
  }

  // ─── CATÁLOGO ───
  cargarCatalogo() {
    this.cargando.set(true);
    const id_sucursal = this.sesion.idSucursal();

    this.productoService.obtenerInventario(id_sucursal).subscribe({
      next: (datos: any[]) => {
        const productos = (datos || [])
          .map(p => ({
            ...p,
            stock_actual:    Number(p.stock_actual)    || 0,
            precio_unitario: Number(p.precio_unitario) || 0
          }))
          .filter(p => p.stock_actual > 0);
        this.productosDisponibles.set(productos);
        this.enfocarBuscador();

        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
    this.promociones.vigentesPuntoVenta().subscribe({ next: (v) => this.vigentes.set(v) });
  }

  // ─── TECLADO ───
  // Escribir + Enter agrega el producto marcado; Enter con el buscador vacío abre el cobro
  enterBuscador(evento: Event) {
    evento.preventDefault();
    const producto = this.primero();
    if (producto) {
      this.agregarAlCarrito(producto);
      this.buscadorRef?.nativeElement.select();
    } else if (!this.busqueda().trim() && this.carrito().length) {
      this.abrirModalCobro();
    }
  }

  limpiarBusqueda(evento: Event) {
    if (!this.busqueda()) return;
    evento.stopPropagation();
    this.busqueda.set('');
  }

  /** Deja el cursor en el buscador si no está en otro campo */
  enfocarBuscador() {
    this.enfocarCampo(() => this.buscadorRef?.nativeElement);
  }

  private enfocarCampo(campo: () => HTMLElement | undefined) {
    if (pantallaTactil()) return;
    afterNextRender(() => { if (!focoOcupado()) enfocar(campo()); }, { injector: this.injector });
  }

  // ─── CARRITO ───
  agregarAlCarrito(producto: any) {
    const precio          = Number(producto.precio_unitario) || 0;
    const stockDisponible = Number(producto.stock_actual)    || 0;

    if (stockDisponible <= 0) {
      this.dialogo.error(`Sin stock: ${producto.nombre_producto}`); return;
    }

    const existe = this.carrito().some(i => i.id_producto === producto.id_producto);
    this.carrito.update(c => existe
      ? c.map(i => i.id_producto === producto.id_producto
          ? { ...i, cantidad: Number(i.cantidad) + 1, precio_unitario: precio, subtotal: (Number(i.cantidad) + 1) * precio }
          : i)
      : [...c, { ...producto, cantidad: 1, precio_unitario: precio, subtotal: precio }]);

    this.productosDisponibles.update(ps => ps.map(p =>
      p.id_producto === producto.id_producto ? { ...p, stock_actual: stockDisponible - 1 } : p));
  }

  quitarDelCarrito(index: number) {
    const item = this.carrito()[index];
    if (!item) return;

    this.productosDisponibles.update(ps => ps.map(p =>
      p.id_producto === item.id_producto ? { ...p, stock_actual: Number(p.stock_actual) + Number(item.cantidad) } : p));

    this.carrito.update(c => c.filter((_, i) => i !== index));
  }

  // ─── COBRO ───
  abrirModalCobro() {
    if (!this.carrito().length) return;
    if (!this.puedeVender()) {
      this.dialogo.error('La caja está cerrada. No puedes registrar ventas.');
      return;
    }
    this.metodoPago.set(this.ajustes.config().pago_efectivo ? METODO_PAGO.efectivo : METODO_PAGO.qr);
    this.montoPagado.set(null);
    this.mostrarModalCobro.set(true);
  }

  /** Efectivo: cursor en el monto; QR: en «Confirmar venta» (Enter cobra) */
  elegirMetodo(metodo: MetodoPago) {
    this.metodoPago.set(metodo);
    afterNextRender(() => enfocar(metodo === METODO_PAGO.efectivo
      ? this.inputMontoRef?.nativeElement
      : document.querySelector<HTMLElement>('.ventana [data-enter]')), { injector: this.injector });
  }

  cerrarModalCobro() { this.mostrarModalCobro.set(false); this.enfocarBuscador(); }

  // ─── DESCUENTO MANUAL ───
  abrirDescuento() {
    this.formDescuento.set({ ...(this.descuento() ?? { tipo: 'PORCENTAJE', valor: null, motivo: '' }) });
    this.errorDescuento.set('');
    this.mostrarDescuento.set(true);
  }

  cerrarDescuento() { if (!this.aplicandoDescuento()) this.mostrarDescuento.set(false); }

  aplicarDescuento() {
    const d: DescuentoManual = { ...this.formDescuento(), valor: Number(this.formDescuento().valor) || 0 };
    if (!(d.valor > 0)) return this.errorDescuento.set('Indica el descuento.');
    if (d.motivo.trim().length < 3) return this.errorDescuento.set('Indica el motivo del descuento.');
    // Se valida con el backend antes de aplicarlo (tope del cajero, total)
    this.aplicandoDescuento.set(true);
    this.promociones.cotizarVenta(this.detalles(), d).subscribe({
      next: (datos) => {
        this.aplicandoDescuento.set(false);
        this.descuento.set(d);
        this.cotizacionGuardada.set({ clave: this.clave(), datos });
        this.mostrarDescuento.set(false);
        this.enfocarBuscador();
      },
      error: (e) => {
        this.aplicandoDescuento.set(false);
        this.errorDescuento.set(e?.error?.detalle || 'No se pudo aplicar el descuento.');
      }
    });
  }

  quitarDescuento() { this.descuento.set(null); }

  confirmarVenta() {
    if (this.metodoPago() === METODO_PAGO.efectivo && this.pagado() < this.total()) {
      this.montoPagado.set(this.total());
    }
    this.mostrarModalCobro.set(false);
    this.registrarVenta();
  }

  registrarVenta() {
    this.cargando.set(true);

    const datosVenta = {
      id_sucursal:       this.sesion.idSucursal(),
      id_cliente:        null,
      id_pedido_mesa:    null,
      monto_total_venta: this.total(),
      metodo_pago:       this.metodoPago(),
      descuento:         this.descuento(),
      detalles: this.carrito().map(item => ({
        id_producto: item.id_producto,
        cantidad:    item.cantidad,
        precio:      Number(item.precio_unitario),
        subtotal:    Number(item.subtotal)
      }))
    };

    this.http.post<any>(
      `${this.apiUrl}/caja/cobrar`,
      datosVenta
    ).subscribe({
      next: (res) => {
        const cot: Cotizacion | undefined = res.cotizacion;
        const lineas = new Map((cot?.items || []).map(l => [l.id_producto, l]));
        this.datosTicket.set({
          id_venta: res.id_venta,
          items:    this.carrito().map(i => {
            const l = lineas.get(i.id_producto);
            return { nombre_producto: i.nombre_producto, cantidad: i.cantidad, precio_unitario: Number(i.precio_unitario),
                     subtotal: l?.subtotal_bruto ?? Number(i.subtotal), descuento: l?.descuento_promocion || 0,
                     promocion: l?.promociones.join(', ') };
          }),
          total:    cot?.total ?? this.total(),
          descuento_promociones: cot?.descuento_promociones || 0,
          descuento_manual:      cot?.descuento_manual || 0,
          motivo_descuento:      this.descuento()?.motivo ?? null,
          metodo:   this.metodoPago(),
          cambio:   this.cambio()
        });
        this.fechaTicket.set(new Date());
        this.mostrarTicket.set(true);
        this.carrito.set([]);
        this.descuento.set(null);
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.cargando.set(false);
      },
      error: (e: any) => {
        // CAJA_CERRADA → reverificar estado y bloquear
        if (e?.error?.error === 'CAJA_CERRADA') {
          this.dialogo.error(e?.error?.detalle || 'La caja fue cerrada. Pide al administrador que la reabra.');
          this.verificarAccesoCaja();
          this.cargando.set(false);
          return;
        }
        // PRECIO_DESACTUALIZADO → un precio cambió en la BD: actualizar el carrito y volver a cobrar
        if (e?.error?.error === 'PRECIO_DESACTUALIZADO') {
          const precios = new Map<number, number>(
            (e.error.precios || []).map((p: any) => [Number(p.id_producto), Number(p.precio_unitario)])
          );
          this.carrito.update(c => c.map(i => {
            const precio = precios.get(Number(i.id_producto)) ?? Number(i.precio_unitario);
            return { ...i, precio_unitario: precio, subtotal: precio * Number(i.cantidad) };
          }));
          if (e.error.cotizacion) this.cotizacionGuardada.set({ clave: this.clave(), datos: e.error.cotizacion });
          this.dialogo.error(`Los precios cambiaron. Nuevo total: ${this.moneda()} ${Number(e.error.total).toFixed(2)}. Revisa el carrito y vuelve a cobrar.`);
          this.cargarCatalogo();
          this.cargando.set(false);
          return;
        }
        const msg = e?.error?.detalle || e?.error?.error || 'Error desconocido al registrar la venta.';
        this.dialogo.error(`No se pudo registrar la venta: ${msg}`);
        this.cargando.set(false);
      }
    });
  }

  // ─── HISTORIAL VENTAS DEL DÍA ───
  cargarVentasHoy() {
    this.cargandoVentas.set(true);
    const id_sucursal   = this.sesion.idSucursal();

    this.cajaService.obtenerVentasHoy(id_sucursal).subscribe({
      next: (v: any[]) => {
        this.ventasHoy.set((v || []).map(x => ({
          ...x,
          monto_total_venta: Number(x.monto_total_venta) || 0,
          items: (x.items || []).map((it: any) => ({
            ...it,
            cantidad_vendida: Number(it.cantidad_vendida) || 0,
            precio_unitario:  Number(it.precio_unitario)  || 0,
            subtotal_venta:   Number(it.subtotal_venta)   || 0
          }))
        })));
        this.cargandoVentas.set(false);
      },
      error: () => this.cargandoVentas.set(false)
    });
  }

  toggleHistorial() {
    this.mostrarHistorial.set(!this.mostrarHistorial());
    if (this.mostrarHistorial()) this.cargarVentasHoy();
  }

  cerrarTicket() {
    this.mostrarTicket.set(false);
    this.datosTicket.set(null);
    this.enfocarBuscador();
  }

  /** Imprime y deja la caja lista para la siguiente venta */
  imprimirVenta() {
    this.impresion.imprimirTicket(this.zonaTicket?.nativeElement, this.ajustes.config().ticket_ancho);
    this.cerrarTicket();
  }
}
