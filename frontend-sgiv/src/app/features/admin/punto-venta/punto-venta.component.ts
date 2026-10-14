import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
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
  private cdr             = inject(ChangeDetectorRef);
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
  verificandoCaja = true;
  estadoCaja: EstadoCajaCompleto['estado'] = 'SIN_APERTURA';
  puedeVender = false;
  usuarioActual: any = null;

  // ─── Turno ───
  turnoActivo: any   = null;
  mostrarAbrirTurno  = false;   // se muestra cuando SIN_APERTURA
  montoInicial       = 0;
  abriendoTurno      = false;
  errorTurno         = '';

  // ─── Catálogo ───
  productosDisponibles: any[] = [];
  categorias: { id: number; nombre: string }[] = [];
  categoriaFiltro: number | null = null;
  busqueda = '';
  cargando = true;

  get productosFiltrados(): any[] {
    const q = this.busqueda.trim().toLowerCase();
    return this.productosDisponibles.filter(p => {
      const porCat  = !this.categoriaFiltro || Number(p.id_categoria) === this.categoriaFiltro;
      const porNomb = !q ||
        (p.nombre_producto || '').toLowerCase().includes(q) ||
        (p.nombre_categoria || '').toLowerCase().includes(q);
      return porCat && porNomb;
    });
  }

  // ─── Carrito ───
  carrito: any[] = [];

  get unidades(): number {
    return this.carrito.reduce((s, i) => s + Number(i.cantidad), 0);
  }

  get total(): number {
    return this.carrito.reduce(
      (s, i) => s + (Number(i.precio_unitario) * Number(i.cantidad) || 0),
      0
    );
  }

  // ─── Modal cobro ───
  mostrarModalCobro = false;
  metodoPago        = 'Efectivo';
  montoPagado       = 0;
  @ViewChild('inputMonto') inputMontoRef?: ElementRef<HTMLInputElement>;
  @ViewChild('zonaTicket') zonaTicket?: ElementRef<HTMLElement>;
  get cambio(): number { return Math.max(0, this.montoPagado - this.total); }

  // ─── Ticket ───
  mostrarTicket = false;
  datosTicket: any = null;
  fechaTicket = new Date();

  // ─── Historial ventas ───
  ventasHoy: any[] = [];
  cargandoVentas   = false;
  mostrarHistorial = false;

  // ─── Poll periódico del estado de caja (por si el admin cierra mientras vendemos) ───
  private detenerSondeo?: () => void;

  get totalVentasHoy(): number {
    return this.ventasHoy.reduce((s, v) => s + Number(v.monto_total_venta), 0);
  }

  get metodosHoy(): { metodo: string; total: number }[] {
    const totales = new Map<string, number>();
    for (const v of this.ventasHoy) totales.set(v.metodo_pago, (totales.get(v.metodo_pago) || 0) + v.monto_total_venta);
    return [...totales].map(([metodo, total]) => ({ metodo, total }));
  }

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

      this.productosDisponibles = this.productosDisponibles.map(p =>
        Number(p.id_producto) === idProd
          ? { ...p, stock_actual: nuevo }
          : p
      );
      this.cdr.detectChanges();
    });
  }

  // ─── VERIFICACIÓN PRINCIPAL ───
  verificarAccesoCaja() {
    this.verificandoCaja = true;

    // Admin: acceso libre (no opera caja)
    if (this.usuarioActual?.id_rol === 1) {
      this.estadoCaja      = 'ABIERTA';
      this.puedeVender     = true;
      this.verificandoCaja = false;
      this.cargarCatalogo();
      this.cargarVentasHoy();
      return;
    }

    this.cajaService.obtenerEstadoCompleto().subscribe({
      next: (res) => this.aplicarEstado(res),
      error: () => {
        this.estadoCaja      = 'SIN_APERTURA';
        this.puedeVender     = false;
        this.verificandoCaja = false;
        this.cargando        = false;
        this.cdr.detectChanges();
      }
    });
  }

  private aplicarEstado(res: EstadoCajaCompleto) {
    this.estadoCaja      = res.estado;
    this.puedeVender     = res.puede_vender;
    this.turnoActivo     = res.turno;
    this.verificandoCaja = false;

    // Sincronizar localStorage para que otros componentes vean el flag
    if (this.usuarioActual) {
      this.usuarioActual.caja_habilitada = res.caja_habilitada;
      localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
    }

    if (res.estado === 'ABIERTA') {
      this.mostrarAbrirTurno = false;
      this.cargarCatalogo();
      this.cargarVentasHoy();
      this.iniciarPollEstado();
    } else if (res.estado === 'SIN_APERTURA') {
      // Apertura automática del día — mostrar modal para monto inicial
      this.mostrarAbrirTurno = true;
      this.cargando          = false;
    } else {
      // CERRADA — bloquear y mostrar mensaje al cajero
      this.mostrarAbrirTurno = false;
      this.cargando          = false;
    }
    this.cdr.detectChanges();
  }

  private iniciarPollEstado() {
    this.detenerSondeo?.();
    // Cada 30s reverificar — si el admin cierra desde Usuarios, bloqueamos rápido
    this.detenerSondeo = sondeo(() => {
      if (this.usuarioActual?.id_rol === 1) return;
      this.cajaService.obtenerEstadoCompleto().subscribe({
        next: (res) => {
          if (res.estado !== this.estadoCaja) this.aplicarEstado(res);
        }
      });
    }, 30000);
  }

  // ─── APERTURA AUTOMÁTICA DIARIA ───
  confirmarAbrirTurno() {
    if (this.montoInicial < 0) { this.errorTurno = 'Monto inválido.'; return; }
    this.abriendoTurno = true;
    this.errorTurno    = '';

    this.cajaService.abrirTurno({
      id_sucursal:   this.usuarioActual?.id_sucursal || 1,
      monto_inicial: this.montoInicial
    }).subscribe({
      next: (res) => {
        this.turnoActivo       = res.turno;
        this.estadoCaja        = 'ABIERTA';
        this.puedeVender       = true;
        this.mostrarAbrirTurno = false;
        this.abriendoTurno     = false;
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = true;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.iniciarPollEstado();
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        this.errorTurno    = e?.error?.error || 'Error al abrir el turno.';
        this.abriendoTurno = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── CATÁLOGO ───
  cargarCatalogo() {
    this.cargando = true;
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;

    this.productoService.obtenerInventario(id_sucursal).subscribe({
      next: (datos: any[]) => {
        this.productosDisponibles = (datos || [])
          .map(p => ({
            ...p,
            stock_actual:    Number(p.stock_actual)    || 0,
            precio_unitario: Number(p.precio_unitario) || 0
          }))
          .filter(p => p.stock_actual > 0);

        const mapCats = new Map<number, string>();
        this.productosDisponibles.forEach(p => mapCats.set(Number(p.id_categoria), p.nombre_categoria));
        this.categorias = Array.from(mapCats.entries())
          .map(([id, nombre]) => ({ id, nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  // ─── CARRITO ───
  agregarAlCarrito(producto: any) {
    const precio          = Number(producto.precio_unitario) || 0;
    const stockDisponible = Number(producto.stock_actual)    || 0;

    if (stockDisponible <= 0) {
      this.dialogo.error(`Sin stock: ${producto.nombre_producto}`); return;
    }

    const existe = this.carrito.find(i => i.id_producto === producto.id_producto);
    if (existe) {
      this.carrito = this.carrito.map(i =>
        i.id_producto === producto.id_producto
          ? { ...i, cantidad: Number(i.cantidad) + 1, precio_unitario: precio, subtotal: (Number(i.cantidad) + 1) * precio }
          : i
      );
    } else {
      this.carrito = [
        ...this.carrito,
        { ...producto, cantidad: 1, precio_unitario: precio, subtotal: precio }
      ];
    }

    this.productosDisponibles = this.productosDisponibles.map(p =>
      p.id_producto === producto.id_producto
        ? { ...p, stock_actual: stockDisponible - 1 }
        : p
    );

    this.cdr.detectChanges();
  }

  quitarDelCarrito(index: number) {
    const item = this.carrito[index];
    if (!item) return;

    this.productosDisponibles = this.productosDisponibles.map(p =>
      p.id_producto === item.id_producto
        ? { ...p, stock_actual: Number(p.stock_actual) + Number(item.cantidad) }
        : p
    );

    this.carrito = this.carrito.filter((_, i) => i !== index);
    this.cdr.detectChanges();
  }

  // ─── COBRO ───
  abrirModalCobro() {
    if (!this.carrito.length) return;
    if (!this.puedeVender) {
      this.dialogo.error('La caja está cerrada. No puedes registrar ventas.');
      return;
    }
    this.metodoPago  = this.ajustes.config().pago_efectivo ? 'Efectivo' : 'QR';
    this.montoPagado = 0;
    this.mostrarModalCobro = true;
    setTimeout(() => {
      const el = this.inputMontoRef?.nativeElement;
      if (el) { el.focus(); el.select(); }
    }, 60);
  }

  cerrarModalCobro() { this.mostrarModalCobro = false; }

  confirmarVenta() {
    if (this.metodoPago === 'Efectivo' && (!this.montoPagado || this.montoPagado < this.total)) {
      this.montoPagado = this.total;
    }
    this.mostrarModalCobro = false;
    this.registrarVenta();
  }

  registrarVenta() {
    this.cargando = true;

    const datosVenta = {
      id_sucursal:       this.usuarioActual?.id_sucursal || 1,
      id_cliente:        null,
      id_pedido_mesa:    null,
      monto_total_venta: this.total,
      metodo_pago:       this.metodoPago,
      detalles: this.carrito.map(item => ({
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
        this.datosTicket = {
          id_venta: res.id_venta,
          items:    [...this.carrito],
          total:    this.total,
          metodo:   this.metodoPago,
          cambio:   this.cambio
        };
        this.fechaTicket   = new Date();
        this.mostrarTicket = true;
        this.carrito       = [];
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        // CAJA_CERRADA → reverificar estado y bloquear
        if (e?.error?.error === 'CAJA_CERRADA') {
          this.dialogo.error('La caja fue cerrada. Pide al administrador que la reabra.');
          this.verificarAccesoCaja();
          this.cargando = false;
          this.cdr.detectChanges();
          return;
        }
        // PRECIO_DESACTUALIZADO → un precio cambió en la BD: actualizar el carrito y volver a cobrar
        if (e?.error?.error === 'PRECIO_DESACTUALIZADO') {
          const precios = new Map<number, number>(
            (e.error.precios || []).map((p: any) => [Number(p.id_producto), Number(p.precio_unitario)])
          );
          this.carrito = this.carrito.map(i => {
            const precio = precios.get(Number(i.id_producto)) ?? Number(i.precio_unitario);
            return { ...i, precio_unitario: precio, subtotal: precio * Number(i.cantidad) };
          });
          this.dialogo.error(`Los precios cambiaron. Nuevo total: ${this.moneda()} ${Number(e.error.total).toFixed(2)}. Revisa el carrito y vuelve a cobrar.`);
          this.cargarCatalogo();
          this.cargando = false;
          this.cdr.detectChanges();
          return;
        }
        const msg = e?.error?.detalle || e?.error?.error || 'Error desconocido al registrar la venta.';
        this.dialogo.error(`No se pudo registrar la venta: ${msg}`);
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── HISTORIAL VENTAS DEL DÍA ───
  cargarVentasHoy() {
    this.cargandoVentas = true;
    const id_sucursal   = this.usuarioActual?.id_sucursal || 1;

    this.cajaService.obtenerVentasHoy(id_sucursal).subscribe({
      next: (v: any[]) => {
        this.ventasHoy = (v || []).map(x => ({
          ...x,
          monto_total_venta: Number(x.monto_total_venta) || 0,
          items: (x.items || []).map((it: any) => ({
            ...it,
            cantidad_vendida: Number(it.cantidad_vendida) || 0,
            precio_unitario:  Number(it.precio_unitario)  || 0,
            subtotal_venta:   Number(it.subtotal_venta)   || 0
          }))
        }));
        this.cargandoVentas = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargandoVentas = false; this.cdr.detectChanges(); }
    });
  }

  toggleHistorial() {
    this.mostrarHistorial = !this.mostrarHistorial;
    if (this.mostrarHistorial) this.cargarVentasHoy();
  }

  cerrarTicket() {
    this.mostrarTicket = false;
    this.datosTicket   = null;
  }

  imprimirVenta() {
    this.impresion.imprimirTicket(this.zonaTicket?.nativeElement, this.ajustes.config().ticket_ancho);
  }
}
