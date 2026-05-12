import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { CajaService } from '../../../core/services/caja.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-punto-venta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './punto-venta.component.html'
})
export class PuntoVentaComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cajaService     = inject(CajaService);
  private cdr             = inject(ChangeDetectorRef);
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

  // ─── Control de acceso ───
  verificandoCaja  = true;
  cajaHabilitada   = false;
  usuarioActual:   any = null;

  // ─── Control de turno ───
  turnoActivo:       any   = null;
  mostrarAbrirTurno        = false;
  montoInicial             = 0;
  abriendoTurno            = false;
  errorTurno               = '';

  // ─── Catálogo y carrito ───
  productosDisponibles: any[] = [];
  carrito:  any[] = [];
  total     = 0;
  cargando  = true;

  // ─── Historial Ventas ───
  ventasHoy:       any[]   = [];
  cargandoVentas   = false;
  mostrarHistorial = false;

  // ─── Ticket ───
  mostrarTicket = false;
  datosTicket:  any = null;
  fechaTicket   = new Date();

  // ─── Modal cobro ───
  mostrarModalCobro = false;
  metodoPago        = 'Efectivo';
  montoPagado       = 0;
  
  get cambio(): number {
    return Math.max(0, this.montoPagado - this.total);
  }

  get totalVentasHoy(): number {
    return this.ventasHoy.reduce((s, v) => s + (+v.monto_total_venta), 0);
  }

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.verificarAccesoCaja();
  }

  // ─── Verificar si la caja está habilitada ───
verificarAccesoCaja() {
  if (this.usuarioActual?.id_rol === 1) {
    this.cajaHabilitada  = true;
    this.verificandoCaja = false;
    this.cargarCatalogo();  // Admin no necesita turno
    return;
  }

  this.cajaService.obtenerEstadoCaja(this.usuarioActual.id_usuario).subscribe({
    next: (res) => {
      this.cajaHabilitada  = res.caja_habilitada;
      this.verificandoCaja = false;
      if (this.cajaHabilitada) {
        this.verificarTurnoActivo();  // ← cambio aquí
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

  // ─── Verificar el turno actual ───
  verificarTurnoActivo() {
    this.cajaService.obtenerTurnoHoy().subscribe({
      next: (res) => {
        this.turnoActivo = res.turno;
        // Si tiene turno (abierto o cerrado hoy), no puede abrir otro
        if (this.turnoActivo?.estado_turno === 'Abierto') {
          this.mostrarAbrirTurno = false;
          this.cargarCatalogo();
        } else if (this.turnoActivo?.estado_turno === 'Cerrado') {
          // Ya cerró caja hoy, no puede reabrir solo
          this.mostrarAbrirTurno = false;
          this.cajaHabilitada    = false; // bloquear POS
        } else {
          // No ha abierto turno hoy, mostrar formulario
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

  confirmarAbrirTurno() {
    if (this.montoInicial < 0) { this.errorTurno = 'Ingresa un monto válido.'; return; }
    this.abriendoTurno = true;
    this.errorTurno    = '';
    const id_sucursal  = this.usuarioActual?.id_sucursal || 1;

    this.cajaService.abrirTurno({ id_sucursal, monto_inicial: this.montoInicial }).subscribe({
      next: (res) => {
        this.turnoActivo       = res.turno;
        this.mostrarAbrirTurno = false;
        this.abriendoTurno     = false;
        this.cargarCatalogo();
        this.cdr.detectChanges();
      },
      error: (e) => {
        this.errorTurno    = e.error?.error || 'Error al abrir turno.';
        this.abriendoTurno = false;
        this.cdr.detectChanges();
      }
    });
  }

  cargarCatalogo() {
    this.cargando = true;
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        this.productosDisponibles = datos.filter((p: any) => (p.stock_actual || 0) > 0);
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarVentasHoy() {
    this.cargandoVentas = true;
    const id_sucursal   = this.usuarioActual?.id_sucursal || 1;
    this.cajaService.obtenerVentasHoy(id_sucursal).subscribe({
      next: (v) => { this.ventasHoy = v; this.cargandoVentas = false; this.cdr.detectChanges(); },
      error: () => { this.cargandoVentas = false; }
    });
  }

  agregarAlCarrito(producto: any) {
    const item   = this.carrito.find(i => i.id_producto === producto.id_producto);
    const stock  = Number(producto.stock_actual) || 0;
    const precio = Number(producto.precio_unitario) || 0;

    if (item) {
      if (item.cantidad < stock) {
        item.cantidad++;
        item.subtotal = item.cantidad * precio;
        producto.stock_actual = stock - item.cantidad;
      } else {
        alert(`Límite de stock: ${stock} unidades.`); return;
      }
    } else {
      if (stock === 0) { alert('Sin stock disponible.'); return; }
      this.carrito.push({ ...producto, cantidad: 1, precio_unitario: precio, subtotal: precio });
      producto.stock_actual = stock - 1;
    }
    this.calcularTotal();
  }

  quitarDelCarrito(index: number) {
    const item   = this.carrito[index];
    const prodIdx = this.productosDisponibles.findIndex(p => p.id_producto === item.id_producto);
    if (prodIdx !== -1) {
      this.productosDisponibles[prodIdx].stock_actual =
        Number(this.productosDisponibles[prodIdx].stock_actual) + item.cantidad;
    }
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((s, i) => s + Number(i.subtotal), 0);
    this.cdr.detectChanges();
  }

  // ─── Modal de cobro ───
  abrirModalCobro() {
    if (this.carrito.length === 0) return;
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
    if (this.carrito.length === 0) return;
    this.cargando = true;

    const token   = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    const datosVenta = {
      id_sucursal:        this.usuarioActual?.id_sucursal || 1,
      id_usuario_cajero:  this.usuarioActual?.id_usuario || 1,
      id_cliente:         null,
      id_pedido_mesa:     null,
      monto_total_venta:  this.total,
      metodo_pago:        this.metodoPago,
      detalles: this.carrito.map(item => ({
        id_producto: item.id_producto,
        cantidad:    item.cantidad,
        precio:      item.precio_unitario,
        subtotal:    item.subtotal
      }))
    };

    this.http.post(`${this.apiUrl}/caja/cobrar`, datosVenta, { headers }).subscribe({
      next: (res: any) => {
        this.datosTicket = {
          id_venta: res.id_venta,
          items:    [...this.carrito],
          total:    this.total,
          metodo:   this.metodoPago,
          cambio:   this.cambio
        };
        this.fechaTicket  = new Date();
        this.mostrarTicket = true;
        this.carrito      = [];
        this.total        = 0;
        this.cargarCatalogo();
        this.cargarVentasHoy();  // ← Actualizar el historial de ventas
        this.cargando     = false;
        this.cdr.detectChanges();
      },
      error: () => {
        alert('Error al procesar la venta.');
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  imprimirVenta() { window.print(); }
  cerrarTicket()  { this.mostrarTicket = false; this.datosTicket = null; }

  // ─── Control de Caja desde Usuarios ───
  toggleCaja(usr: any) {
    if (usr.caja_habilitada) {
      if (!confirm(`¿Cerrar caja de "${usr.nombre_completo}"? No podrá realizar ventas hasta que la vuelvas a abrir.`)) return;
      this.cajaService.deshabilitarCaja(usr.id_usuario).subscribe({
        next: () => { usr.caja_habilitada = false; this.cdr.detectChanges(); },
        error: () => alert('Error al cerrar caja.')
      });
    } else {
      if (!confirm(`¿Abrir caja para "${usr.nombre_completo}"? Podrá realizar ventas.`)) return;
      this.cajaService.habilitarCaja(usr.id_usuario).subscribe({
        next: () => { usr.caja_habilitada = true; this.cdr.detectChanges(); },
        error: () => alert('Error al abrir caja.')
      });
    }
  }
}