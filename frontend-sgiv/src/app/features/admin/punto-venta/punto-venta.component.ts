import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { CajaService }     from '../../../core/services/caja.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment }     from '../../../../environments/environment';

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

  // ─── Estado de acceso ───
  verificandoCaja   = true;
  cajaHabilitada    = false;
  usuarioActual:    any = null;

  // ─── Turno ───
  turnoActivo:      any    = null;
  mostrarAbrirTurno = false;
  montoInicial      = 0;
  abriendoTurno     = false;
  errorTurno        = '';

  // ─── Catálogo ───
  productosDisponibles: any[] = [];
  cargando          = true;

  // ─── Carrito ───
  carrito:          any[] = [];
  total             = 0;

  // ─── Modal cobro ───
  mostrarModalCobro = false;
  metodoPago        = 'Efectivo';
  montoPagado       = 0;
  get cambio(): number { return Math.max(0, this.montoPagado - this.total); }

  // ─── Ticket ───
  mostrarTicket     = false;
  datosTicket:      any = null;
  fechaTicket       = new Date();

  // ─── Historial ventas ───
  ventasHoy:        any[]   = [];
  cargandoVentas    = false;
  mostrarHistorial  = false;

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

  ngOnDestroy() {}

  // ─── PASO 1: Verificar si caja está habilitada ───
  verificarAccesoCaja() {
    this.verificandoCaja = true;

    if (this.usuarioActual?.id_rol === 1) {
      this.cajaHabilitada  = true;
      this.verificandoCaja = false;
      this.cargarCatalogo();
      this.cargarVentasHoy();
      return;
    }

    this.cajaService.obtenerEstadoCaja(this.usuarioActual.id_usuario).subscribe({
      next: (res) => {
        this.cajaHabilitada  = res.caja_habilitada;
        this.verificandoCaja = false;

        if (this.cajaHabilitada) {
          this.verificarTurnoActivo(); // ← pasa al PASO 2
        } else {
          this.cargando = false;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.cajaHabilitada  = false;
        this.verificandoCaja = false;
        this.cargando        = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── PASO 2: Verificar si tiene turno abierto ───
  verificarTurnoActivo() {
    this.cajaService.obtenerTurnoHoy().subscribe({
      next: (res) => {
        this.turnoActivo = res.turno;

        if (this.turnoActivo?.estado_turno === 'Abierto') {
          // Tiene turno abierto → mostrar POS directamente
          this.mostrarAbrirTurno = false;
          this.cargarCatalogo();
          this.cargarVentasHoy();
        } else {
          // Sin turno abierto → mostrar formulario de apertura
          this.mostrarAbrirTurno = true;
          this.cargando          = false;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.mostrarAbrirTurno = true;
        this.cargando          = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── ABRIR TURNO (cajero) ───
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
        this.mostrarAbrirTurno = false;
        this.abriendoTurno     = false;
        this.cargarCatalogo();
        this.cargarVentasHoy();
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
    this.productoService.obtenerInventario().subscribe({
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
    // Siempre restar 1 en 1
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
    const payload = {
      id_sucursal:      this.usuarioActual?.id_sucursal || 1,
      id_usuario_cajero: this.usuarioActual?.id_usuario,
      id_cliente:       null,
      id_pedido_mesa:   null,
      monto_total_venta: this.total,
      metodo_pago:      this.metodoPago,
      detalles: this.carrito.map(i => ({
        id_producto: i.id_producto,
        cantidad:    i.cantidad,
        precio:      i.precio_unitario,
        subtotal:    i.subtotal
      }))
    };

    this.http.post<any>(`${this.apiUrl}/caja/cobrar`, payload, { headers: this.headers() }).subscribe({
      next: (res) => {
        this.datosTicket   = { id_venta: res.id_venta, items: [...this.carrito], total: this.total, metodo: this.metodoPago, cambio: this.cambio };
        this.fechaTicket   = new Date();
        this.mostrarTicket = true;
        this.carrito       = [];
        this.total         = 0;
        this.cargarCatalogo();
        this.cargarVentasHoy();  // actualizar historial tras cada venta
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => {
        alert('Error al registrar la venta.');
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