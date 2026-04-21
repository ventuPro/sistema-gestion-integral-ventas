import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { CommonModule } from '@angular/common';
import { ProductoService } from '../../../core/services/producto.service';
import { FormsModule } from '@angular/forms'; // 1.  leer los inputs del formulario

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule], // 2. Agregamos FormsModule aquí
  templateUrl: './inventario.component.html',
  styleUrl: './inventario.component.css'
})
export class InventarioComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cdr = inject(ChangeDetectorRef); 

  listaProductos: any[] = [];
  cargando: boolean = true;
  
  // 3. Variables para controlar el Modal
  mostrarModal: boolean = false;
  
  // 4. Objeto vacío para guardar los datos que el usuario escriba en el modal
  nuevoProducto: any = {
    nombre_producto: '',
    id_categoria: '',
    precio_unitario: null,
    descripcion_producto: ''
  };

  ngOnInit() {
    this.cargarInventario();
  }

  cargarInventario() {
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        this.listaProductos = datos;
        this.cargando = false;
        this.cdr.detectChanges(); 
      },
      error: (error) => {
        console.error('Error al cargar inventario:', error);
        this.cargando = false;
        this.cdr.detectChanges(); 
      }
    });
  }

  // 5. Funciones para abrir y cerrar la ventana
  abrirModal() {
    this.mostrarModal = true;
  }

  cerrarModal() {
    this.mostrarModal = false;
    // Limpiamos el formulario al cerrar para que esté vacío la próxima vez
    this.nuevoProducto = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '' };
  }

  // 6. Función temporal para ver si estamos capturando los datos (Aún no guarda en BD)
guardarProducto() {
    // Como tu base de datos probablemente pide una URL de imagen (url_imagen),
    // le enviaremos una imagen "placeholder" (de relleno) temporalmente.
    const productoAEnviar = {
      ...this.nuevoProducto,
      url_imagen: 'https://via.placeholder.com/150' 
    };

    // Llamamos a nuestro servicio para enviar los datos al Backend
    this.productoService.crearProducto(productoAEnviar).subscribe({
      next: (respuesta) => {
        console.log('¡Éxito! Producto guardado:', respuesta);
        
        // 1. Cerramos la ventana modal
        this.cerrarModal(); 
        
        // 2. ¡La magia! Volvemos a pedir los datos a la base de datos para actualizar la tabla
        this.cargando = true;
        this.cargarInventario(); 
      },
      error: (error) => {
        console.error('Error al guardar el producto:', error);
        alert('Hubo un problema al guardar el producto. Revisa la consola.');
      }
    });
  }
}