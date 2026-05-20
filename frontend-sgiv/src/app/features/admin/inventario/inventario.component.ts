import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ProductoService } from '../../../core/services/producto.service';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule,
         Pencil, Trash2, PackagePlus, Package,
         AlertTriangle, CheckCircle2, XCircle } from 'lucide-angular';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './inventario.component.html'
})
export class InventarioComponent implements OnInit {
  private productoService = inject(ProductoService);
  private cdr             = inject(ChangeDetectorRef);
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

  // ─── Iconos ───
  readonly icons = {
    edit:     Pencil,
    delete:   Trash2,
    addStock: PackagePlus,
    package:  Package,
    warning:  AlertTriangle,
    ok:       CheckCircle2,
    out:      XCircle
  };

  // ─── Usuario y sucursales ───
  usuarioActual:         any   = null;
  esAdmin                = false;
  sucursales:            any[] = [];
  sucursalSeleccionada:  any   = null;

  // ─── Productos e inventario ───
  productos:             any[] = [];
  productosFiltrados:    any[] = [];
  categorias:            any[] = [];
  cargando               = true;

  // ─── Filtros ───
  filtroCategoria:       number | null = null;
  filtroBusqueda         = '';

  // ─── Modal Producto ───
  mostrarModal           = false;
  editandoId:            number | null = null;
  errorModal             = '';
  archivoImagen:         File | null = null;
  previewImagen:         string | null = null;
  formulario: any = {
    nombre_producto: '', descripcion_producto: '',
    precio_unitario: '', id_categoria: '',
    stock_inicial: 0
  };

  // ─── Modal Stock ───
  mostrarModalStock      = false;
  productoStock:         any = null;
  cantidadAgregar        = 0;
  errorStock             = '';

  // ─── Modal Categoría ───
  mostrarModalCategoria  = false;
  nombreCategoria        = '';
  errorCategoria         = '';

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;

    if (this.esAdmin) {
      this.cargarSucursales();
    } else {
      // Cajero: solo su propia sucursal
      this.sucursalSeleccionada = {
        id_sucursal:    this.usuarioActual?.id_sucursal || 1,
        nombre_sucursal: this.usuarioActual?.nombre_sucursal || 'Mi Sucursal'
      };
      this.cargarProductos();
      this.cargarCategorias();
    }
  }

  // ─── SUCURSALES ───
  cargarSucursales() {
    this.http.get<any[]>(`${this.apiUrl}/sucursales`, { headers: this.h() }).subscribe({
      next: (suc) => {
        this.sucursales = suc;
        if (suc.length > 0 && !this.sucursalSeleccionada) {
          this.seleccionarSucursal(suc[0]);
        }
        this.cdr.detectChanges();
      }
    });
  }

  seleccionarSucursal(suc: any) {
    this.sucursalSeleccionada = suc;
    this.cargando             = true;
    this.cargarProductos();
    this.cargarCategorias();
    this.cdr.detectChanges();
  }

  get idSucursal(): number {
    return this.sucursalSeleccionada?.id_sucursal || 1;
  }

  // ─── PRODUCTOS ───
  cargarProductos() {
    this.cargando = true;
    this.productoService.obtenerInventario(this.idSucursal).subscribe({
      next: (datos) => {
        this.productos          = datos;
        this.productosFiltrados = datos;
        this.aplicarFiltros();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarCategorias() {
    this.productoService.obtenerCategorias().subscribe({
      next: (c) => { this.categorias = c; this.cdr.detectChanges(); }
    });
  }

  // ─── FILTROS ───
  aplicarFiltros() {
    this.productosFiltrados = this.productos.filter(p => {
      const porCat  = !this.filtroCategoria || p.id_categoria === this.filtroCategoria;
      const porNomb = !this.filtroBusqueda  ||
                      p.nombre_producto.toLowerCase().includes(this.filtroBusqueda.toLowerCase());
      return porCat && porNomb;
    });
    this.cdr.detectChanges();
  }

  seleccionarCategoria(id: number | null) {
    this.filtroCategoria = id;
    this.aplicarFiltros();
  }

  // ─── MODAL PRODUCTO ───
  abrirModalNuevo() {
    this.editandoId     = null;
    this.errorModal     = '';
    this.archivoImagen  = null;
    this.previewImagen  = null;
    this.formulario     = {
      nombre_producto: '', descripcion_producto: '',
      precio_unitario: '', id_categoria: '',
      stock_inicial: 0
    };
    this.mostrarModal = true;
  }

  abrirModalEditar(prod: any) {
    this.editandoId    = prod.id_producto;
    this.errorModal    = '';
    this.archivoImagen = null;
    this.previewImagen = prod.url_imagen ? this.getImageUrl(prod.url_imagen) : null;
    this.formulario    = {
      nombre_producto:     prod.nombre_producto,
      descripcion_producto: prod.descripcion_producto || '',
      precio_unitario:     prod.precio_unitario,
      id_categoria:        prod.id_categoria,
      stock_inicial:       0
    };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.errorModal = ''; }

  onArchivoSeleccionado(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      this.errorModal = 'La imagen no debe superar 2MB.'; return;
    }

    this.archivoImagen = file;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.previewImagen = e.target.result;
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

guardarProducto() {
  if (!this.formulario.nombre_producto || !this.formulario.precio_unitario || !this.formulario.id_categoria) {
    this.errorModal = 'Completa todos los campos obligatorios.'; return;
  }

  this.cargando   = true;
  this.errorModal = '';

  if (this.editandoId) {
    // ─── EDITAR: actualiza solo los datos del producto (no el inventario) ───
    const datos = {
      nombre_producto:      this.formulario.nombre_producto,
      descripcion_producto: this.formulario.descripcion_producto || '',
      precio_unitario:      this.formulario.precio_unitario,
      id_categoria:         this.formulario.id_categoria
    };
    this.productoService.actualizarProducto(this.editandoId, datos, this.archivoImagen || undefined).subscribe({
      next: () => { this.cerrarModal(); this.cargarProductos(); },
      error: () => { this.errorModal = 'Error al actualizar.'; this.cargando = false; }
    });
  } else {
    // ─── CREAR: incluye id_sucursal y stock_inicial para asignar a esta sucursal ───
    const datos = {
      nombre_producto:      this.formulario.nombre_producto,
      descripcion_producto: this.formulario.descripcion_producto || '',
      precio_unitario:      this.formulario.precio_unitario,
      id_categoria:         this.formulario.id_categoria,
      id_sucursal:          this.idSucursal,              // ← CLAVE: sucursal seleccionada
      stock_inicial:        this.formulario.stock_inicial || 0   // ← stock inicial
    };
    this.productoService.crearProducto(datos, this.archivoImagen || undefined).subscribe({
      next: () => { this.cerrarModal(); this.cargarProductos(); },
      error: (e: any) => {
        this.errorModal = e?.error?.error || 'Error al crear el producto.';
        this.cargando = false;
      }
    });
  }
}
  eliminarProducto(id: number, nombre: string) {
    if (!confirm(`¿Eliminar "${nombre}" del inventario?`)) return;
    this.productoService.eliminarProducto(id).subscribe({
      next: () => this.cargarProductos(),
      error: () => alert('Error al eliminar.')
    });
  }

  // ─── MODAL STOCK ───
  abrirModalStock(prod: any) {
    this.productoStock  = prod;
    this.cantidadAgregar = 0;
    this.errorStock      = '';
    this.mostrarModalStock = true;
  }

  cerrarModalStock() { this.mostrarModalStock = false; this.productoStock = null; }

  agregarStock() {
    if (!this.cantidadAgregar || this.cantidadAgregar <= 0) {
      this.errorStock = 'Ingresa una cantidad válida.'; return;
    }
    this.cargando = true;
    this.productoService.agregarStock(
      this.productoStock.id_producto,
      this.cantidadAgregar,
      this.idSucursal
    ).subscribe({
      next: () => { this.cerrarModalStock(); this.cargarProductos(); },
      error: () => { this.errorStock = 'Error al agregar stock.'; this.cargando = false; }
    });
  }

  // ─── MODAL CATEGORÍA ───
  abrirModalCategoria() { this.nombreCategoria = ''; this.errorCategoria = ''; this.mostrarModalCategoria = true; }
  cerrarModalCategoria() { this.mostrarModalCategoria = false; }

  crearCategoria() {
    if (!this.nombreCategoria.trim()) { this.errorCategoria = 'Escribe el nombre.'; return; }
    this.productoService.crearCategoria({ nombre_categoria: this.nombreCategoria, descripcion_categoria: '' }).subscribe({
      next: () => { this.cerrarModalCategoria(); this.cargarCategorias(); },
      error: () => { this.errorCategoria = 'Error al crear.'; }
    });
  }

  // ─── UTILIDADES ───
  getImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http')) return url;
    const host = environment.apiUrl.replace('/api', '');
    return `${host}${url}`;
  }

  getStockColor(stock: number): string {
    if (stock <= 0)  return 'bg-red-100 text-red-700';
    if (stock <= 5)  return 'bg-amber-100 text-amber-700';
    return 'bg-green-100 text-green-700';
  }
}