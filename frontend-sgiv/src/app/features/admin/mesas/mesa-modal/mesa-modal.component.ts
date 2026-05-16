import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CuentaService } from '../../../../core/services/cuenta.service';
import { SocketService } from '../../../../core/services/socket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-mesa-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mesa-modal.component.html'
})
export class MesaModalComponent implements OnInit, OnDestroy {
  @Input()  mesa:       any = null;  // La mesa seleccionada
  @Output() cerrado     = new EventEmitter<void>();
  @Output() mesaActualizada = new EventEmitter<void>();

  private cuentaService = inject(CuentaService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);

  // Estado
  cargando        = false;
  cuentaActiva:   any = null;
  vista: 'info' | 'comanda' | 'pago' | 'qr' = 'info';

  // Catálogo
  productos:      any[] = [];
  categorias:     any[] = [];
  categoriaFiltro: number | null = null;
  busqueda        = '';

  // Pago
  metodoPago      = 'Efectivo';
  montoPagado     = 0;
  get cambio(): number { return Math.max(0, this.montoPagado - (this.cuentaActiva?.total_acumulado || 0)); }

  // QR
  qrData: any = null;

  // Notas
  notaProducto    = '';
  productoSeleccionado: any = null;

  private subs: Subscription[] = [];

  ngOnInit() {
    this.cargarEstadoMesa();
    this.cargarProductos();
    this.escucharSocket();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private escucharSocket() {
    // Cuando llegue un pedido QR de esta mesa, actualizar la comanda
    const sub = this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      if (data.id_mesa === this.mesa?.id_mesa) {
        this.cuentaActiva = {
          ...this.cuentaActiva,
          total_acumulado: data.total_acumulado,
          items: data.items
        };
        this.cdr.detectChanges();
      }
    });
    this.subs.push(sub);
  }

  cargarEstadoMesa() {
    this.cargando = true;
    this.cuentaService.getCuentaActiva(this.mesa.id_mesa).subscribe({
      next: (res) => {
        this.cuentaActiva = res.cuenta;
        this.vista        = this.cuentaActiva ? 'comanda' : 'info';
        this.cargando     = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; }
    });
  }

  cargarProductos() {
    this.cuentaService.getProductos().subscribe({
      next: (prods) => {
        this.productos = prods.filter((p: any) => (p.stock_actual || 0) > 0);
        const cats = new Map();
        this.productos.forEach((p: any) => cats.set(p.id_categoria, p.nombre_categoria));
        this.categorias = Array.from(cats.entries()).map(([id, nombre]) => ({ id, nombre }));
        this.cdr.detectChanges();
      }
    });
  }

  get productosFiltrados(): any[] {
    return this.productos.filter(p => {
      const porCategoria = !this.categoriaFiltro || p.id_categoria === this.categoriaFiltro;
      const porBusqueda  = !this.busqueda || p.nombre_producto.toLowerCase().includes(this.busqueda.toLowerCase());
      return porCategoria && porBusqueda;
    });
  }

  // ─── ABRIR MESA ───
  abrirMesa() {
    this.cargando = true;
    this.cuentaService.abrirCuenta(this.mesa.id_mesa).subscribe({
      next: (res) => {
        this.cuentaActiva = { ...res.cuenta, items: [], total_acumulado: 0 };
        this.vista        = 'comanda';
        this.cargando     = false;
        this.mesaActualizada.emit();
        this.cdr.detectChanges();
      },
      error: (e) => {
        alert(e?.error?.error || 'Error al abrir la mesa');
        this.cargando = false;
      }
    });
  }

  // ─── AGREGAR PRODUCTO A LA COMANDA ───
  agregarProducto(producto: any) {
    if (!this.cuentaActiva) return;

    this.cuentaService.agregarProducto(this.cuentaActiva.id_cuenta, {
      id_producto:    producto.id_producto,
      cantidad:       1,
      precio_unitario: Number(producto.precio_unitario),
      nota:            this.notaProducto || undefined
    }).subscribe({
      next: (res) => {
        // Actualizar la lista de items y el total
        this.cargarEstadoMesa();
        this.notaProducto = '';
        this.cdr.detectChanges();
      },
      error: (e) => alert(e?.error?.error || 'Error al agregar producto')
    });
  }

  // ─── QUITAR PRODUCTO ───
  quitarProducto(id_detalle: number) {
    if (!confirm('¿Quitar este producto de la comanda?')) return;
    this.cuentaService.quitarProducto(id_detalle).subscribe({
      next: () => this.cargarEstadoMesa(),
      error: (e) => alert(e?.error?.error || 'Error al quitar producto')
    });
  }

  // ─── IR A PAGO ───
  irAPago() {
    this.montoPagado = this.cuentaActiva?.total_acumulado || 0;
    this.vista = 'pago';
  }

  // ─── CERRAR CUENTA ───
  confirmarPago() {
    if (this.metodoPago === 'Efectivo' && this.montoPagado < (this.cuentaActiva?.total_acumulado || 0)) {
      alert('El monto pagado es insuficiente'); return;
    }

    const usr         = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    const id_sucursal = usr.id_sucursal || 1;

    this.cargando = true;
    this.cuentaService.cerrarCuenta(this.cuentaActiva.id_cuenta, this.metodoPago, id_sucursal).subscribe({
      next: (res) => {
        this.cargando = false;
        this.mesaActualizada.emit();
        window.print(); // imprimir ticket
        this.cerrarModal();
      },
      error: (e) => {
        alert(e?.error?.error || 'Error al cerrar la cuenta');
        this.cargando = false;
      }
    });
  }

  // ─── QR ───
  verQR() {
    this.vista = 'qr';
    if (!this.qrData) {
      this.cuentaService.getQR(this.mesa.id_mesa).subscribe({
        next: (data) => { this.qrData = data; this.cdr.detectChanges(); }
      });
    }
  }

  descargarQR() {
    if (!this.qrData) return;
    const a = document.createElement('a');
    a.href = this.qrData.qr;
    a.download = `QR_Mesa_${this.mesa.numero_mesa}.png`;
    a.click();
  }

  cerrarModal() { this.cerrado.emit(); }
}