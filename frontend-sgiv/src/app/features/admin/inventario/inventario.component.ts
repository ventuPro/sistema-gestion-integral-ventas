import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductoService } from '../../../core/services/producto.service';

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

  listaProductos: any[] = [];
  listaProductosFiltrados: any[] = [];
  listaCategorias: any[] = [];
  cargando = true;

  // Filtros
  categoriaFiltro: string = 'todas';
  busqueda: string = '';

  // Modal CRUD
  mostrarModal = false;
  editandoId: number | null = null;
  nuevoProducto: any = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '', url_imagen: '' };
  imagenPreview: string = '';

  // Modal Stock
  mostrarModalStock = false;
  productoSeleccionado: any = null;
  cantidadIngreso = 0;

  // Modal Categorías
  mostrarModalCategorias = false;
  nuevaCategoria = { nombre_categoria: '', descripcion_categoria: '' };
  cargandoCategoria = false;
  mensajeCategoriaError = '';

  ngOnInit() {
    this.cargarInventario();
    this.cargarCategorias();
  }

  cargarInventario() {
    this.cargando = true;
    this.productoService.obtenerInventario().subscribe({
      next: (datos) => {
        this.listaProductos = datos;
        this.aplicarFiltros();
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

  aplicarFiltros() {
    let lista = [...this.listaProductos];
    if (this.categoriaFiltro !== 'todas') {
      lista = lista.filter(p => p.id_categoria == this.categoriaFiltro);
    }
    if (this.busqueda.trim()) {
      const term = this.busqueda.toLowerCase();
      lista = lista.filter(p => p.nombre_producto.toLowerCase().includes(term));
    }
    this.listaProductosFiltrados = lista;
  }

  // ─── Modal CRUD ───
  abrirModal() {
    this.editandoId = null;
    this.imagenPreview = '';
    this.nuevoProducto = { nombre_producto: '', id_categoria: '', precio_unitario: null, descripcion_producto: '', url_imagen: '' };
    this.mostrarModal = true;
  }

  abrirModalEditar(p: any) {
    this.editandoId = p.id_producto;
    this.imagenPreview = p.url_imagen || '';
    this.nuevoProducto = {
      nombre_producto: p.nombre_producto,
      id_categoria: p.id_categoria,
      precio_unitario: p.precio_unitario,
      descripcion_producto: p.descripcion_producto || '',
      url_imagen: p.url_imagen || ''
    };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.imagenPreview = ''; }

  // Manejo de imagen (convierte a base64)
  onImagenSeleccionada(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('La imagen no debe superar 2MB.'); return; }
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.nuevoProducto.url_imagen = e.target.result;
      this.imagenPreview = e.target.result;
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  quitarImagen() { this.nuevoProducto.url_imagen = ''; this.imagenPreview = ''; }

  guardarProducto() {
    this.cargando = true;
    if (this.editandoId) {
      this.productoService.actualizarProducto(this.editandoId, this.nuevoProducto).subscribe({
        next: () => { this.cerrarModal(); this.cargarInventario(); },
        error: () => { alert('Error al editar producto.'); this.cargando = false; }
      });
    } else {
      this.productoService.crearProducto(this.nuevoProducto).subscribe({
        next: () => { this.cerrarModal(); this.cargarInventario(); },
        error: () => { alert('Error al guardar producto.'); this.cargando = false; }
      });
    }
  }

  // ─── Modal Stock ───
  abrirModalStock(p: any) { this.productoSeleccionado = p; this.cantidadIngreso = 0; this.mostrarModalStock = true; }
  cerrarModalStock() { this.mostrarModalStock = false; this.productoSeleccionado = null; }

  confirmarIngresoStock() {
    if (this.cantidadIngreso <= 0) { alert('Ingresa una cantidad válida.'); return; }
    this.cargando = true;
    this.productoService.ingresarStock(this.productoSeleccionado.id_producto, this.cantidadIngreso).subscribe({
      next: () => { this.cerrarModalStock(); this.cargarInventario(); },
      error: () => { alert('Error al ingresar stock.'); this.cargando = false; }
    });
  }

  // ─── Modal Categorías ───
  abrirModalCategorias() { this.mostrarModalCategorias = true; this.mensajeCategoriaError = ''; this.nuevaCategoria = { nombre_categoria: '', descripcion_categoria: '' }; }
  cerrarModalCategorias() { this.mostrarModalCategorias = false; }

  guardarCategoria() {
    if (!this.nuevaCategoria.nombre_categoria.trim()) { this.mensajeCategoriaError = 'El nombre es obligatorio.'; return; }
    this.cargandoCategoria = true;
    this.productoService.crearCategoria(this.nuevaCategoria.nombre_categoria, this.nuevaCategoria.descripcion_categoria).subscribe({
      next: () => {
        this.nuevaCategoria = { nombre_categoria: '', descripcion_categoria: '' };
        this.mensajeCategoriaError = '';
        this.cargandoCategoria = false;
        this.cargarCategorias();
      },
      error: () => { this.mensajeCategoriaError = 'Error al crear categoría.'; this.cargandoCategoria = false; }
    });
  }

  borrarProducto(id: number, nombre: string) {
    if (!confirm(`¿Eliminar el producto "${nombre}"?`)) return;
    this.cargando = true;
    this.productoService.eliminarProducto(id).subscribe({
      next: () => this.cargarInventario(),
      error: () => { alert('Error al eliminar.'); this.cargando = false; }
    });
  }

  getNombreCategoria(id: any): string {
    const cat = this.listaCategorias.find(c => c.id_categoria == id);
    return cat ? cat.nombre_categoria : 'Sin categoría';
  }
}