import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-punto-venta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './punto-venta.component.html',
  styleUrl: './punto-venta.component.css'
})
export class PuntoVentaComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  productosDisponibles: any[] = [];
  productosFiltrados:   any[] = [];
  carrito: any[] = [];
  total = 0;
  cargando = true;

  busquedaPV = '';
  categoriaSeleccionada = 'todas';
  listaCategorias: any[] = [];

  // Modal de cobro (checkout)
  mostrarModalCobro = false;
  metodoPago: 'Efectivo' | 'QR' = 'Efectivo';
  montoRecibido = 0;
  get cambio(): number {
    if (this.metodoPago !== 'Efectivo') return 0;
    const c = this.montoRecibido - this.total;
    return c > 0 ? c : 0;
  }
  get pagoInsuficiente(): boolean {
    return this.metodoPago === 'Efectivo' && this.montoRecibido < this.total;
  }

  // Ticket
  mostrarTicket = false;
  datosTicket: any = null;
  fechaTicket = new Date();

  // Historial sesión
  historialSesion: any[] = [];
  totalSesion = 0;
  vistaActual: 'catalogo' | 'historial' = 'catalogo';

  ngOnInit() {
    this.cargarCatalogo();
    this.cargarCategorias();
  }

  cargarCatalogo() {
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        this.productosDisponibles = datos.filter((p: any) => (p.stock_actual || 0) > 0);
        this.productosFiltrados   = [...this.productosDisponibles];
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarCategorias() {
    this.productoService.obtenerCategorias().subscribe({
      next: (datos) => { this.listaCategorias = datos; }
    });
  }

  filtrarProductos() {
    let lista = [...this.productosDisponibles];
    if (this.categoriaSeleccionada !== 'todas') {
      lista = lista.filter(p => p.id_categoria == this.categoriaSeleccionada);
    }
    if (this.busquedaPV.trim()) {
      lista = lista.filter(p => p.nombre_producto.toLowerCase().includes(this.busquedaPV.toLowerCase()));
    }
    this.productosFiltrados = lista;
  }

agregarAlCarrito(producto: any) {
  const item   = this.carrito.find(i => i.id_producto === producto.id_producto);
  const stock  = Number(producto.stock_actual) || 0;
  const precio = Number(producto.precio_unitario) || 0;

  if (item) {
    if (item.cantidad < stock) {
      item.cantidad++;
      item.subtotal = item.cantidad * precio;
      // FIX: decrementar visualmente el stock en el catálogo
      producto.stock_actual = stock - item.cantidad;
    } else {
      alert(`Límite de stock: ${stock} unidades.`); return;
    }
  } else {
    if (stock === 0) { alert('Sin stock disponible.'); return; }
    this.carrito.push({ ...producto, cantidad: 1, precio_unitario: precio, subtotal: precio });
    // FIX: decrementar visualmente
    producto.stock_actual = stock - 1;
  }
  this.calcularTotal();
}

// También actualiza quitarDelCarrito para restituir el stock visual:
quitarDelCarrito(i: number) {
  const item    = this.carrito[i];
  const prodIdx = this.productosDisponibles.findIndex(p => p.id_producto === item.id_producto);
  if (prodIdx !== -1) {
    this.productosDisponibles[prodIdx].stock_actual =
      Number(this.productosDisponibles[prodIdx].stock_actual) + item.cantidad;
  }
  this.carrito.splice(i, 1);
  this.filtrarProductos();
  this.calcularTotal();
}

  calcularTotal() {
    this.total = this.carrito.reduce((s, i) => s + Number(i.subtotal), 0);
    this.cdr.detectChanges();
  }

  // Abre el modal de cobro (ya NO guarda directamente)
  abrirModalCobro() {
    if (this.carrito.length === 0) return;
    this.metodoPago    = 'Efectivo';
    this.montoRecibido = 0;
    this.mostrarModalCobro = true;
  }

  cerrarModalCobro() { this.mostrarModalCobro = false; }

  // Confirma y guarda la venta
  confirmarPago() {
    if (this.pagoInsuficiente) return;
    this.mostrarModalCobro = false;
    this.cargando = true;

    const token   = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    const datosVenta = {
      id_sucursal: 1, id_usuario_cajero: 1, id_cliente: null,
      id_pedido_mesa: null, id_turno: 1,
      monto_total_venta: this.total,
      metodo_pago: this.metodoPago,
      detalles: this.carrito.map(i => ({
        id_producto: i.id_producto, cantidad: i.cantidad,
        precio: i.precio_unitario, subtotal: i.subtotal
      }))
    };

    this.http.post(`${this.apiUrl}/caja/cobrar`, datosVenta, { headers }).subscribe({
      next: (res: any) => {
        const ventaRegistrada = {
          id_venta:  res.id_venta,
          hora:      new Date(),
          items:     [...this.carrito],
          total:     this.total,
          metodo:    this.metodoPago,
          cambio:    this.cambio,
          cajero:    JSON.parse(localStorage.getItem('usuario_sgiv') || '{}')?.nombre_completo || 'Cajero'
        };
        this.datosTicket  = { ...ventaRegistrada };
        this.fechaTicket  = new Date();
        this.mostrarTicket = true;

        this.historialSesion.unshift(ventaRegistrada);
        this.totalSesion += this.total;

        this.carrito = [];
        this.total   = 0;
        this.cargarCatalogo();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => {
        alert('Error al procesar la venta. Revise el stock.');
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  imprimirVenta() { window.print(); }
  cerrarTicket()  { this.mostrarTicket = false; this.datosTicket = null; }
  cambiarVista(v: 'catalogo' | 'historial') { this.vistaActual = v; }
}