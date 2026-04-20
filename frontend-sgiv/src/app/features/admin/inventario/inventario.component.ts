import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductoService } from '../../../core/services/producto.service';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule], // <-- Vital para usar *ngFor en el HTML
  templateUrl: './inventario.component.html',
  styleUrl: './inventario.component.css'
})
export class InventarioComponent implements OnInit {
  private productoService = inject(ProductoService);
  
  // Aquí guardaremos los productos que lleguen de la base de datos
  listaProductos: any[] = [];
  cargando: boolean = true;

  ngOnInit() {
    this.cargarInventario();
  }

  cargarInventario() {
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        console.log('Productos recibidos:', datos); // Para espiar en la consola
        this.listaProductos = datos;
        this.cargando = false;
      },
      error: (error) => {
        console.error('Error al cargar inventario:', error);
        this.cargando = false;
      }
    });
  }
}