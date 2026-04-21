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

  // --- Variables de Datos ---
  listaProductos: any[] = [];
  listaCategorias: any[] = []; 
  cargando: boolean = true;
  
  // --- Control de Modales (CRUD) ---
  mostrarModal: boolean = false;
  editandoId: number | null = null; 

  // --- Control de Modal de Stock ---
  mostrarModalStock: boolean = false;
  productoSeleccionado: any = null;
  cantidadIngreso: number = 0;

  // --- Objetos para Formularios ---
  nuevoProducto: any = {
    nombre_producto: '',
    id_categoria: '',
    precio_unitario: null,
    descripcion_producto: ''
  };

  ngOnInit() {
    this.cargarInventario();
    this.cargarCategorias(); 
  }

  // --- Carga de Datos desde la BD ---
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

  // --- Funciones del Modal CRUD (Crear/Editar) ---
  abrirModal() {
    this.editandoId = null;
    this.nuevoProducto = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '' };
    this.mostrarModal = true;
  }

  abrirModalEditar(producto: any) {
    this.editandoId = producto.id_producto;
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
    } else {
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

  // --- Funciones del Modal de Stock (Nueva Lógica) ---
  abrirModalStock(producto: any) {
    this.productoSeleccionado = producto;
    this.cantidadIngreso = 0; 
    this.mostrarModalStock = true;
  }

  cerrarModalStock() {
    this.mostrarModalStock = false;
    this.productoSeleccionado = null;
  }

  confirmarIngresoStock() {
    if (this.cantidadIngreso <= 0) {
      alert('Por favor, ingresa una cantidad válida.');
      return;
    }

    this.cargando = true;
    this.productoService.ingresarStock(this.productoSeleccionado.id_producto, this.cantidadIngreso).subscribe({
      next: (res) => {
        console.log(res.mensaje);
        this.cerrarModalStock();
        this.cargarInventario(); 
      },
      error: (err) => {
        console.error('Error al ingresar stock:', err);
        alert('No se pudo actualizar el stock.');
        this.cargando = false;
      }
    });
  }

  // --- Función de Borrado ---
  borrarProducto(id: number, nombre: string) {
    const confirmacion = confirm(`¿Estás seguro de que deseas eliminar el producto: "${nombre}"?`);
    if (confirmacion) {
      this.cargando = true;
      this.productoService.eliminarProducto(id).subscribe({
        next: (respuesta) => {
          console.log(respuesta.mensaje);
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