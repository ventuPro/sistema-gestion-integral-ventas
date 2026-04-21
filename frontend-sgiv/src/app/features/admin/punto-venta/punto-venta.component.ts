import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';
import { HttpClient, HttpHeaders } from '@angular/common/http'; // 1. Importamos HttpClient
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
  private http = inject(HttpClient); // 2. Inyectamos HttpClient
  private apiUrl = environment.apiUrl;

  productosDisponibles: any[] = [];
  carrito: any[] = [];
  total: number = 0;
  cargando: boolean = true;

  ngOnInit() {
    this.cargarCatalogo();
  }

  cargarCatalogo() {
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        // TEMPORAL: Mostramos todos para probar el diseño
        this.productosDisponibles = datos;
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

    if (itemExistente) {
      if (itemExistente.cantidad < (producto.stock_actual || 0) || true) { // Temporalmente ignoramos stock para probar
        itemExistente.cantidad++;
        itemExistente.subtotal = itemExistente.cantidad * itemExistente.precio_unitario;
      } else {
        alert(`No hay más stock de ${producto.nombre_producto}`);
      }
    } else {
      this.carrito.push({
        ...producto,
        cantidad: 1,
        subtotal: Number(producto.precio_unitario)
      });
    }
    
    this.calcularTotal();
  }

  quitarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = this.carrito.reduce((suma, item) => suma + item.subtotal, 0);
  }

  // 3. NUESTRA FUNCIÓN ESTRELLA
  registrarVenta() {
    if (this.carrito.length === 0) return;

    this.cargando = true; // Mostramos que estamos trabajando
    
    // Obtenemos el token de seguridad
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    // ARMAMOS EL PAQUETE EXACTAMENTE COMO LO PIDE TU CAJAMODEL.JS
    const datosVenta = {
      id_sucursal: 1,           // Temporal: Asumimos sucursal 1
      id_usuario_cajero: 1,     // Temporal: Asumimos usuario 1
      id_cliente: null,         // Venta al paso (anónimo)
      id_pedido_mesa: null,     // Venta directa
      id_turno: 1,              // Temporal: Asumimos turno 1
      monto_total_venta: this.total,
      metodo_pago: 'Efectivo',  
      
      // Transformamos tu carrito de Angular a los detalles que pide tu Node.js
      detalles: this.carrito.map(item => ({
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio: item.precio_unitario,
        subtotal: item.subtotal
      }))
    };

    // Apuntamos a la ruta exacta de tu cajaRoutes.js: /api/caja/cobrar
    this.http.post(`${this.apiUrl}/caja/cobrar`, datosVenta, { headers }).subscribe({
      next: (respuesta: any) => {
        console.log('¡Venta Exitosa!', respuesta);
        alert(`¡Venta #${respuesta.id_venta} registrada con éxito!`);
        
        // Limpiamos la pantalla
        this.carrito = [];
        this.total = 0;
        this.cargarCatalogo(); // Recargamos para ver los nuevos stocks
      },
      error: (error) => {
        console.error('Error al registrar venta:', error);
        alert('Hubo un error al procesar la venta. Revisa la consola para más detalles.');
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }
}