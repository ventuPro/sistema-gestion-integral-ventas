import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { CajaService, EstadoCajaCompleto } from '../../../core/services/caja.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-punto-venta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './punto-venta.component.html'
})
export class PuntoVentaComponent implements OnInit, OnDestroy {
  private productoService = inject(ProductoService);
  private cajaService     = inject(CajaService);
  private cdr             = inject(ChangeDetectorRef);
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

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
  cargando = true;

  // ─── Carrito ───
  carrito: any[] = [];
  total = 0;

  // ─── Modal cobro ───
  mostrarModalCobro = false;
  metodoPago        = 'Efectivo';
  montoPagado       = 0;
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
  private pollEstado: any;

  get totalVentasHoy(): number {
    return this.ventasHoy.reduce((s, v) => s + Number(v.monto_total_venta), 0);
  }

  private headers(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.verificarAccesoCaja();
  }

  ngOnDestroy() {
    if (this.pollEstado) clearInterval(this.pollEstado);
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
    if (this.pollEstado) clearInterval(this.pollEstado);
    // Cada 30s reverificar — si el admin cierra desde Usuarios, bloqueamos rápido
    this.pollEstado = setInterval(() => {
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
        this.productosDisponibles = datos.filter(p => Number(p.stock_actual) > 0);
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
      alert(`Sin stock para: ${producto.nombre_producto}`); return;
    }

    const item = this.carrito.find(i => i.id_producto === producto.id_producto);
    if (item) {
      item.cantidad++;
      item.subtotal = item.cantidad * precio;
    } else {
      this.carrito.push({ ...producto, cantidad: 1, precio_unitario: precio, subtotal: precio });
    }
    producto.stock_actual = stockDisponible - 1;
    this.calcularTotal();
  }

  quitarDelCarrito(index: number) {
    const item    = this.carrito[index];
    const prodIdx = this.productosDisponibles.findIndex(p => p.id_producto === item.id_producto);
    if (prodIdx !== -1)
      this.productosDisponibles[prodIdx].stock_actual =
        Number(this.productosDisponibles[prodIdx].stock_actual) + item.cantidad;
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((s, i) => s + Number(i.subtotal), 0);
    this.cdr.detectChanges();
  }

  // ─── COBRO ───
  abrirModalCobro() {
    if (!this.carrito.length) return;
    if (!this.puedeVender) {
      alert('La caja está cerrada. No puedes registrar ventas.');
      return;
    }
    this.metodoPago  = 'Efectivo';
    this.montoPagado = this.total;
    this.mostrarModalCobro = true;
  }

  cerrarModalCobro() { this.mostrarModalCobro = false; }

  confirmarVenta() {
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
      datosVenta,
      { headers: this.headers() }
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
        this.total         = 0;
        this.cargarCatalogo();
        this.cargarVentasHoy();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        // CAJA_CERRADA → reverificar estado y bloquear
        if (e?.error?.error === 'CAJA_CERRADA') {
          alert('La caja fue cerrada. Pide al administrador que la reabra.');
          this.verificarAccesoCaja();
          this.cargando = false;
          this.cdr.detectChanges();
          return;
        }
        const msg = e?.error?.detalle || e?.error?.error || 'Error desconocido al registrar la venta.';
        console.error('Error venta:', msg);
        alert(`Error al registrar: ${msg}`);
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
      next:  (v: any[]) => { this.ventasHoy = v; this.cargandoVentas = false; this.cdr.detectChanges(); },
      error: ()         => { this.cargandoVentas = false; this.cdr.detectChanges(); }
    });
  }

  toggleHistorial() {
    this.mostrarHistorial = !this.mostrarHistorial;
    if (this.mostrarHistorial) this.cargarVentasHoy();
  }

  // ─── TICKET ───
  imprimirVenta() { window.print(); }
  cerrarTicket()  { this.mostrarTicket = false; this.datosTicket = null; }
}
