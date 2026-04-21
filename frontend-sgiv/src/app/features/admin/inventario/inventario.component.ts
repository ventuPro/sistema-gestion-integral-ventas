import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { CommonModule } from '@angular/common';
import { ProductoService } from '../../../core/services/producto.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventario.component.html',
  styleUrl: './inventario.component.css'
})
export class InventarioComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cdr = inject(ChangeDetectorRef); 

  // Variables de datos
  listaProductos: any[] = [];
  listaCategorias: any[] = []; // Guardará las categorías de la pastelería
  cargando: boolean = true;
  
  // Control del Modal
  mostrarModal: boolean = false;
  editandoId: number | null = null; // Si es null, creamos. Si tiene un número, editamos.

  // Objeto para el formulario
  nuevoProducto: any = {
    nombre_producto: '',
    id_categoria: '',
    precio_unitario: null,
    descripcion_producto: ''
  };

  ngOnInit() {
    this.cargarInventario();
    this.cargarCategorias(); // Al iniciar, traemos productos y categorías
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

  cargarCategorias() {
    this.productoService.obtenerCategorias().subscribe({
      next: (datos) => {
        this.listaCategorias = datos;
      },
      error: (error) => {
        console.error('Error al cargar categorías:', error);
      }
    });
  }

  // Funciones de la Interfaz
abrirModal() {
    this.editandoId = null; // Nos aseguramos de que sepa que es uno NUEVO
    this.nuevoProducto = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '' };
    this.mostrarModal = true;
  }

  abrirModalEditar(producto: any) {
    this.editandoId = producto.id_producto; // Guardamos el ID del que vamos a editar
    
    // Hacemos una copia exacta de los datos para rellenar el formulario
    this.nuevoProducto = { 
      nombre_producto: producto.nombre_producto,
      id_categoria: producto.id_categoria,
      precio_unitario: producto.precio_unitario,
      descripcion_producto: producto.descripcion_producto || ''
    };
    this.mostrarModal = true;
  }

  cerrarModal() {
    this.mostrarModal = false;
    this.editandoId = null;
    this.nuevoProducto = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '' };
  }

guardarProducto() {
    const productoAEnviar = {
      ...this.nuevoProducto,
      url_imagen: 'https://via.placeholder.com/150'
    };

    this.cargando = true;

    // CAMINO 1: Si tenemos un ID guardado, significa que estamos EDITANDO
    if (this.editandoId) {
      this.productoService.actualizarProducto(this.editandoId, productoAEnviar).subscribe({
        next: (respuesta) => {
          console.log('¡Éxito! Producto actualizado:', respuesta);
          this.cerrarModal();
          this.cargarInventario();
        },
        error: (error) => {
          console.error('Error al actualizar:', error);
          alert('Hubo un error al editar el producto.');
          this.cargando = false;
        }
      });
    } 
    // CAMINO 2: Si el ID es null, significa que estamos CREANDO (Tu código de antes)
    else {
      this.productoService.crearProducto(productoAEnviar).subscribe({
        next: (respuesta) => {
          console.log('¡Éxito! Producto guardado:', respuesta);
          this.cerrarModal();
          this.cargarInventario();
        },
        error: (error) => {
          console.error('Error al guardar:', error);
          alert('Hubo un problema al guardar el producto.');
          this.cargando = false;
        }
      });
    }
  }

  borrarProducto(id: number, nombre: string) {
    // 1. Pedimos confirmación para evitar borrados por accidente
    const confirmacion = confirm(`¿Estás seguro de que deseas eliminar el producto: "${nombre}"?`);
    
    if (confirmacion) {
      this.cargando = true; // Mostramos que estamos trabajando
      
      // 2. Llamamos al servicio
      this.productoService.eliminarProducto(id).subscribe({
        next: (respuesta) => {
          console.log(respuesta.mensaje);
          // 3. Volvemos a cargar la tabla para que el producto desaparezca de la vista
          this.cargarInventario();
        },
        error: (error) => {
          console.error('Error al eliminar:', error);
          alert('Hubo un error al intentar eliminar el producto.');
          this.cargando = false;
        }
      });
    }
  }
}