import { Component, computed, inject, OnInit, OnDestroy, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { CajaService, EstadoCajaCompleto } from '../../../core/services/caja.service';
import { SocketService } from '../../../core/services/socket.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Subscription } from 'rxjs';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { TicketComponent } from '../../shared/ticket/ticket.component';
import { LucideAngularModule,
         ShieldAlert, Landmark, RefreshCw, Check, Search, X, ReceiptText, Trash2,
         ShoppingCart, Banknote, QrCode, Printer } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { ImpresionService } from '../../../core/services/impresion.service';
import { sondeo } from '../../../core/utils/sondeo';
import { cifra, fechaLarga } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';
import { METODO_PAGO, MetodoPago } from '../../../core/utils/metodos-pago';

@Component({
  selector: 'app-punto-venta',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ImagenUrlPipe, TicketComponent],
  templateUrl: './punto-venta.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css', './punto-venta.component.css']
})
export class PuntoVentaComponent implements OnInit, OnDestroy {
  private productoService = inject(ProductoService);
  private dialogo = inject(DialogoService);
  private cajaService     = inject(CajaService);
  private socketService   = inject(SocketService);
  readonly ajustes         = inject(AjustesService);
  private impresion = inject(ImpresionService);
  readonly moneda          = this.ajustes.moneda;
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

  private stockSub?: Subscription;

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
    imprimir:    Printer
  };

  readonly cifra    = cifra;
  readonly hoyTexto = fechaLarga(new Date());

  // ─── Estado de acceso (fuente: backend) ───
  readonly verificandoCaja = signal(true);
  readonly estadoCaja      = signal<EstadoCajaCompleto['estado']>('SIN_APERTURA');
  readonly puedeVender     = signal(false);
  usuarioActual: any = null;

  // ─── Turno ───
  readonly turnoActivo       = signal<any>(null);
  readonly mostrarAbrirTurno = signal(false);   // se muestra cuando SIN_APERTURA
  readonly montoInicial      = signal(0);
  readonly abriendoTurno     = signal(false);
  readonly errorTurno        = signal('');

  // ─── Catálogo ───
  readonly productosDisponibles = signal<any[]>([]);
  readonly categorias           = signal<{ id: number; nombre: string }[]>([]);
  readonly categoriaFiltro      = signal<number | null>(null);
  readonly busqueda             = signal('');
  readonly cargando             = signal(true);

  readonly productosFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase(), cat = this.categoriaFiltro();
    return this.productosDisponibles().filter(p => {
      const porCat  = !cat || Number(p.id_categoria) === cat;
      const porNomb = !q ||
        (p.nombre_producto || '').toLowerCase().includes(q) ||
        (p.nombre_categoria || '').toLowerCase().includes(q);
      return porCat && porNomb;
    });
  });

  // ─── Carrito ───
  readonly carrito = signal<any[]>([]);

  readonly unidades = computed(() => this.carrito().reduce((s, i) => s + Number(i.cantidad), 0));

  readonly total = computed(() =>
    this.carrito().reduce((s, i) => s + (Number(i.precio_unitario) * Number(i.cantidad) || 0), 0));

  // ─── Modal cobro ───
  readonly mostrarModalCobro = signal(false);
  readonly metodo = METODO_PAGO;
  readonly metodoPago  = signal<MetodoPago>(METODO_PAGO.efectivo);
  readonly montoPagado = signal(0);
  @ViewChild('inputMonto') inputMontoRef?: ElementRef<HTMLInputElement>;
  @ViewChild('zonaTicket') zonaTicket?: ElementRef<HTMLElement>;
  readonly cambio = computed(() => Math.max(0, this.montoPagado() - this.total()));

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

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.verificarAccesoCaja();
    this.suscribirStockGlobal();
  }

  ngOnDestroy() {
    this.detenerSondeo?.();
    this.stockSub?.unsubscribe();
  }

  private suscribirStockGlobal() {
    this.socketService.conectar('cajeros');
    this.stockSub = this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(payload => {
      if (!payload) return;
      const idSuc = Number(this.usuarioActual?.id_sucursal) || 1;
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

    // Admin: acceso libre (no opera caja)
    if (this.usuarioActual?.id_rol === 1) {
      this.estadoCaja.set('ABIERTA');
      this.puedeVender.set(true);
      this.verificandoCaja.set(false);
      this.cargarCatalogo();
      this.cargarVentasHoy();
      return;
    }

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
    this.puedeVender.set(res.puede_vender);
    this.turnoActivo.set(res.turno);
    this.verificandoCaja.set(false);

    // Sincronizar localStorage para que otros componentes vean el flag
    if (this.usuarioActual) {
      this.usuarioActual.caja_habilitada = res.caja_habilitada;
      localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
    }

    if (res.estado === 'ABIERTA') {
      this.mostrarAbrirTurno.set(false);
      this.cargarCatalogo();
      this.cargarVentasHoy();
      this.iniciarPollEstado();
    } else if (res.estado === 'SIN_APERTURA') {
      // Apertura automática del día — mostrar modal para monto inicial
      this.mostrarAbrirTurno.set(true);
      this.cargando.set(false);
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
      if (this.usuarioActual?.id_rol === 1) return;
      this.cajaService.obtenerEstadoCompleto().subscribe({
        next: (res) => {
          if (res.estado !== this.estadoCaja()) this.aplicarEstado(res);
        }
      });
    }, 30000);
  }

  // ─── APERTURA AUTOMÁTICA DIARIA ───
  confirmarAbrirTurno() {
    if (this.montoInicial() < 0) return this.errorTurno.set('Monto inválido.');
    this.abriendoTurno.set(true);
    this.errorTurno.set('');

    this.cajaService.abrirTurno({
      id_sucursal:   this.usuarioActual?.id_sucursal || 1,
      monto_inicial: this.montoInicial()
    }).subscribe({
      next: (res) => {
        this.turnoActivo.set(res.turno);
        this.estadoCaja.set('ABIERTA');
        this.puedeVender.set(true);
        this.mostrarAbrirTurno.set(false);
        this.abriendoTurno.set(false);
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = true;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }
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
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;

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

        const mapCats = new Map<number, string>();
        productos.forEach(p => mapCats.set(Number(p.id_categoria), p.nombre_categoria));
        this.categorias.set(Array.from(mapCats.entries())
          .map(([id, nombre]) => ({ id, nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre)));

        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
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
    this.montoPagado.set(0);
    this.mostrarModalCobro.set(true);
    setTimeout(() => {
      const el = this.inputMontoRef?.nativeElement;
      if (el) { el.focus(); el.select(); }
    }, 60);
  }

  cerrarModalCobro() { this.mostrarModalCobro.set(false); }

  confirmarVenta() {
    if (this.metodoPago() === METODO_PAGO.efectivo && (!this.montoPagado() || this.montoPagado() < this.total())) {
      this.montoPagado.set(this.total());
    }
    this.mostrarModalCobro.set(false);
    this.registrarVenta();
  }

  registrarVenta() {
    this.cargando.set(true);

    const datosVenta = {
      id_sucursal:       this.usuarioActual?.id_sucursal || 1,
      id_cliente:        null,
      id_pedido_mesa:    null,
      monto_total_venta: this.total(),
      metodo_pago:       this.metodoPago(),
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
        this.datosTicket.set({
          id_venta: res.id_venta,
          items:    [...this.carrito()],
          total:    this.total(),
          metodo:   this.metodoPago(),
          cambio:   this.cambio()
        });
        this.fechaTicket.set(new Date());
        this.mostrarTicket.set(true);
        this.carrito.set([]);
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.cargando.set(false);
      },
      error: (e: any) => {
        // CAJA_CERRADA → reverificar estado y bloquear
        if (e?.error?.error === 'CAJA_CERRADA') {
          this.dialogo.error('La caja fue cerrada. Pide al administrador que la reabra.');
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
    const id_sucursal   = this.usuarioActual?.id_sucursal || 1;

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
  }

  imprimirVenta() {
    this.impresion.imprimirTicket(this.zonaTicket?.nativeElement, this.ajustes.config().ticket_ancho);
  }
}
