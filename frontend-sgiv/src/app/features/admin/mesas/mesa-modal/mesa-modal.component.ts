import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
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
  @Input()  mesa:             any = null;
  @Output() cerrado           = new EventEmitter<void>();
  @Output() mesaActualizada   = new EventEmitter<void>();

  private cuentaService = inject(CuentaService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);

  esAdmin         = false;
  cargando        = false;
  cuentaActiva:   any = null;
  vista: 'info' | 'comanda' | 'pago' | 'qr' | 'ticket' = 'info';

  productos:      any[] = [];
  categorias:     any[] = [];
  categoriaFiltro: number | null = null;
  busqueda        = '';

  metodoPago      = 'Efectivo';
  montoPagado     = 0;
  @ViewChild('inputMontoMesa') inputMontoMesaRef?: ElementRef<HTMLInputElement>;
  get cambio(): number {
    return Math.max(0, this.montoPagado - Number(this.cuentaActiva?.total_acumulado || 0));
  }
  get totalCuenta(): number {
    return Number(this.cuentaActiva?.total_acumulado || 0);
  }

  datosTicket: any = null;
  fechaTicket = new Date();

  qrData: any = null;

  notaProducto = '';

  private subs: Subscription[] = [];

  ngOnInit() {
    const usr = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    this.esAdmin = usr.id_rol === 1;
    this.cargarEstadoMesa();
    this.cargarProductos();
    this.escucharSocket();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  private escucharSocket() {
    const sub = this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      if (data.id_mesa === this.mesa?.id_mesa && data.items) {
        this.cuentaActiva.items          = data.items;
        this.cuentaActiva.total_acumulado = data.total_acumulado;
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
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  forzarReset() {
    if (!confirm(`¿Resetear la Mesa ${this.mesa.numero_mesa}?\nEsto cancelará la cuenta actual y liberará la mesa.`)) return;
    if (!this.esAdmin) { alert('Solo el administrador puede hacer esto.'); return; }

    this.cargando = true;
    this.cuentaService.resetMesa(this.mesa.id_mesa).subscribe({
      next: () => {
        this.cargando = false;
        this.mesaActualizada.emit();
        this.cerrarModal();
      },
      error: () => { this.cargando = false; alert('Error al resetear.'); }
    });
  }

  cargarProductos() {
    const id_sucursal = Number(this.mesa?.id_sucursal) || 1;

    this.cuentaService.getProductos(id_sucursal).subscribe({
      next: (prods: any[]) => {
        this.productos = prods.filter(p => Number(p.stock_actual) > 0);

        const cats = new Map<number, string>();
        this.productos.forEach(p => cats.set(Number(p.id_categoria), p.nombre_categoria));
        this.categorias = Array.from(cats.entries()).map(([id, nombre]) => ({ id, nombre }));

        this.cdr.detectChanges();
      },
      error: () => {
        console.error('Error al cargar catálogo de la mesa');
      }
    });
  }

  get productosFiltrados(): any[] {
    return this.productos.filter(p => {
      const porCat    = !this.categoriaFiltro || p.id_categoria === this.categoriaFiltro;
      const porNombre = !this.busqueda || p.nombre_producto.toLowerCase().includes(this.busqueda.toLowerCase());
      return porCat && porNombre;
    });
  }

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
      error: (e: any) => {
        alert(e?.error?.error || 'Error al abrir la mesa');
        this.cargando = false;
      }
    });
  }

  agregarProducto(producto: any) {
    if (!this.cuentaActiva) return;

    const stockDisponible = Number(producto.stock_actual) || 0;
    if (stockDisponible <= 0) {
      alert(`Sin stock para: ${producto.nombre_producto}`);
      return;
    }

    const precio = Number(producto.precio_unitario);

    this.cuentaService.agregarProducto(this.cuentaActiva.id_cuenta, {
      id_producto:     producto.id_producto,
      cantidad:        1,
      precio_unitario: precio,
      nota:            this.notaProducto || undefined
    }).subscribe({
      next: (res: any) => {
        if (!this.cuentaActiva.items) this.cuentaActiva.items = [];

        const itemExistente = this.cuentaActiva.items.find(
          (i: any) => i.id_producto === producto.id_producto && i.origen === 'cajero'
        );

        if (itemExistente) {
          itemExistente.cantidad++;
          itemExistente.subtotal = itemExistente.cantidad * precio;
        } else {
          this.cuentaActiva.items.push({
            id_detalle_cuenta: res.detalle?.id_detalle_cuenta,
            id_producto:       producto.id_producto,
            nombre_producto:   producto.nombre_producto,
            url_imagen:        producto.url_imagen,
            precio_unitario:   precio,
            cantidad:          1,
            subtotal:          precio,
            nota:              this.notaProducto || null,
            origen:            'cajero'
          });
        }

        producto.stock_actual = stockDisponible - 1;
        this.cuentaActiva.total_acumulado = res.total ?? this.calcularTotalLocal();
        this.notaProducto = '';
        this.cdr.detectChanges();
      },
      error: (e: any) => alert(e?.error?.error || 'Error al agregar producto')
    });
  }

  quitarProducto(id_detalle: number) {
    if (!confirm('¿Quitar este producto?')) return;

    const itemQuitado = this.cuentaActiva?.items?.find(
      (i: any) => i.id_detalle_cuenta === id_detalle
    );

    this.cuentaService.quitarProducto(id_detalle).subscribe({
      next: (res: any) => {
        this.cuentaActiva.items = this.cuentaActiva.items.filter(
          (i: any) => i.id_detalle_cuenta !== id_detalle
        );

        if (itemQuitado) {
          const prod = this.productos.find(p => p.id_producto === itemQuitado.id_producto);
          if (prod) prod.stock_actual = Number(prod.stock_actual) + Number(itemQuitado.cantidad || 1);
        }

        this.cuentaActiva.total_acumulado = res.total ?? this.calcularTotalLocal();
        this.cdr.detectChanges();
      },
      error: (e: any) => alert(e?.error?.error || 'Error al quitar producto')
    });
  }

  private calcularTotalLocal(): number {
    return this.cuentaActiva?.items?.reduce(
      (s: number, i: any) => s + Number(i.subtotal), 0
    ) || 0;
  }

  irAPago() {
    this.montoPagado = 0;
    this.metodoPago  = 'Efectivo';
    this.vista       = 'pago';
    setTimeout(() => {
      const el = this.inputMontoMesaRef?.nativeElement;
      if (el) { el.focus(); el.select(); }
    }, 60);
  }

  confirmarPago() {
    if (this.metodoPago === 'Efectivo' &&
        this.montoPagado < Number(this.cuentaActiva?.total_acumulado || 0)) {
      alert('El monto es insuficiente'); return;
    }

    const usr         = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    const id_sucursal = usr.id_sucursal || 1;

    this.cargando = true;
    this.cuentaService.cerrarCuenta(
      this.cuentaActiva.id_cuenta,
      this.metodoPago,
      id_sucursal
    ).subscribe({
      next: (res: any) => {
        this.datosTicket = {
          id_venta:     res.id_venta,
          numero_mesa:  this.mesa.numero_mesa,
          items:        [...(this.cuentaActiva?.items || [])],
          total:        this.cuentaActiva?.total_acumulado,
          metodo:       this.metodoPago,
          cambio:       this.cambio
        };
        this.fechaTicket = new Date();
        this.cargando    = false;
        this.vista       = 'ticket';
        this.mesaActualizada.emit();
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        alert(e?.error?.error || 'Error al cerrar la cuenta');
        this.cargando = false;
      }
    });
  }

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
    a.href     = this.qrData.qr;
    a.download = `QR_Mesa_${this.mesa.numero_mesa}.png`;
    a.click();
  }

  imprimirTicket() { window.print(); }

  cerrarModal() {
    const cuentaSinItems = this.cuentaActiva
                        && (!this.cuentaActiva.items || this.cuentaActiva.items.length === 0)
                        && this.vista !== 'ticket';
    if (cuentaSinItems) {
      this.cuentaService.cancelarSiVacia(this.cuentaActiva.id_cuenta).subscribe({
        next: () => { this.mesaActualizada.emit(); this.cerrado.emit(); },
        error: () => this.cerrado.emit()
      });
      return;
    }
    this.cerrado.emit();
  }
}
