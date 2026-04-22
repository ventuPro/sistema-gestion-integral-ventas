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
  templateUrl: './punto-venta.component.html'
})
export class PuntoVentaComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  // Variables de Interfaz
  productosDisponibles: any[] = [];
  carrito: any[] = [];
  total: number = 0;
  cargando: boolean = true;

  // --- 1. Variables para el Ticket ---
  mostrarTicket: boolean = false;
  datosTicket: any = null;
  fechaTicket: Date = new Date();

  ngOnInit() {
    this.cargarCatalogo();
  }

  cargarCatalogo() {
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        // Mostramos solo productos con stock
        this.productosDisponibles = datos.filter((p: any) => (p.stock_actual || 0) > 0);
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error al cargar catálogo:', error);
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  agregarAlCarrito(producto: any) {
    const itemExistente = this.carrito.find(item => item.id_producto === producto.id_producto);
    const stockReal = Number(producto.stock_actual) || 0;
    const precioReal = Number(producto.precio_unitario) || 0;

    if (itemExistente) {
      if (itemExistente.cantidad < stockReal) {
        itemExistente.cantidad++;
        itemExistente.subtotal = itemExistente.cantidad * precioReal;
      } else {
        alert(`No hay más stock de ${producto.nombre_producto}. Límite: ${stockReal} unidades.`);
      }
    } else {
      this.carrito.push({
        ...producto,
        cantidad: 1,
        precio_unitario: precioReal, 
        subtotal: precioReal
      });
    }
    this.calcularTotal();
  }

  quitarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((suma, item) => suma + Number(item.subtotal), 0);
    this.cdr.detectChanges(); 
  }

  // --- 2. Función de Registro de Venta con Lógica de Ticket ---
  registrarVenta() {
    if (this.carrito.length === 0) return;

    this.cargando = true;
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    const datosVenta = {
      id_sucursal: 1,
      id_usuario_cajero: 1,
      id_cliente: null,
      id_pedido_mesa: null,
      id_turno: 1,
      monto_total_venta: this.total,
      metodo_pago: 'Efectivo',  
      detalles: this.carrito.map(item => ({
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio: item.precio_unitario,
        subtotal: item.subtotal
      }))
    };

    this.http.post(`${this.apiUrl}/caja/cobrar`, datosVenta, { headers }).subscribe({
      next: (respuesta: any) => {
        this.datosTicket = {
          id_venta: respuesta.id_venta,
          items: [...this.carrito], // Copia de seguridad del carrito
          total: this.total
        };
        this.fechaTicket = new Date();
        this.mostrarTicket = true; // Abrimos el modal del ticket
        
        // Limpieza de la interfaz de venta
        this.carrito = [];
        this.total = 0;
        this.cargarCatalogo(); // Actualizamos stocks
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error al registrar venta:', error);
        alert('Hubo un error al procesar la venta.');
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  // --- 3. Funciones del Ticket ---
  imprimirVenta() {
    window.print();
  }

  cerrarTicket() {
    this.mostrarTicket = false;
    this.datosTicket = null;
  }
}