import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ProductoService } from '../../../core/services/producto.service';
import { SocketService } from '../../../core/services/socket.service';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule,
         Pencil, PackagePlus, RotateCw, Plus, Tag, Search, X, ImagePlus, Ban } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { cifra } from '../../../core/utils/informe';

type FiltroEstado = 'activos' | 'bajo' | 'sin' | 'inactivos' | 'todos';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent, ImagenUrlPipe],
  templateUrl: './inventario.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './inventario.component.css']
})
export class InventarioComponent implements OnInit, OnDestroy {
  private productoService = inject(ProductoService);
  private socketService   = inject(SocketService);
  private cdr             = inject(ChangeDetectorRef);
  readonly moneda          = inject(AjustesService).moneda;
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;
  private stockSub?:      Subscription;
  readonly cifra          = cifra;

  // ─── Iconos ───
  readonly icons = {
    edit:       Pencil,
    addStock:   PackagePlus,
    refresh:    RotateCw,
    mas:        Plus,
    etiqueta:   Tag,
    buscar:     Search,
    cerrar:     X,
    imagen:     ImagePlus,
    desactivar: Ban
  };

  readonly filtrosEstado: { valor: FiltroEstado; texto: string }[] = [
    { valor: 'activos',   texto: 'Activos' },
    { valor: 'bajo',      texto: 'Stock bajo' },
    { valor: 'sin',       texto: 'Sin stock' },
    { valor: 'inactivos', texto: 'Inactivos' },
    { valor: 'todos',     texto: 'Todos' }
  ];

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
  guardando              = false;
  notificacion:          string | null = null;
  resumen = { activos: 0, bajos: 0, agotados: 0, valor: 0 };

  // ─── Filtros ───
  filtroCategoria:       number | null = null;
  filtroBusqueda         = '';
  filtroEstado:          FiltroEstado = 'activos';

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

  // ─── Borrado de categoría (doble confirmación) ───
  mostrarModalBorrarCat   = false;
  catABorrar:             any = null;
  productosBloqueantes:   any[] = [];
  pasoBorradoCat          = 1;
  inputConfirmacionCat    = '';
  errorBorrarCat          = '';
  cargandoBorrarCat       = false;

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;

    this.cargarSucursales();
    this.suscribirStock();
  }

  ngOnDestroy() { this.stockSub?.unsubscribe(); }

  // Ventas de POS, mesas y menú QR actualizan el stock sin recargar
  private suscribirStock() {
    this.socketService.conectar('cajeros');
    this.stockSub = this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (!p || Number(p.id_sucursal) !== this.idSucursal) return;
      const prod = this.productos.find(x => Number(x.id_producto) === Number(p.id_producto));
      if (!prod) return;
      prod.stock_actual = Number(p.nueva_cantidad_disponible) || 0;
      this.aplicarFiltros();
    });
  }

  // ─── SUCURSALES ───
  cargarSucursales() {
    this.http.get<any[]>(`${this.apiUrl}/sucursales`, { headers: this.h() }).subscribe({
      next: (suc) => {
        this.sucursales = suc || [];
        if (this.sucursales.length > 0 && !this.sucursalSeleccionada) {
          this.seleccionarSucursal(this.sucursales[0]);
        } else if (this.sucursales.length === 0) {
          this.usarSucursalPropia();
        }
        this.cdr.detectChanges();
      },
      error: () => this.usarSucursalPropia()
    });
  }

  private usarSucursalPropia() {
    this.sucursalSeleccionada = {
      id_sucursal:     this.usuarioActual?.id_sucursal || 1,
      nombre_sucursal: this.usuarioActual?.nombre_sucursal || 'Mi Sucursal'
    };
    this.cargarProductos();
    this.cargarCategorias();
    this.cdr.detectChanges();
  }

  seleccionarSucursal(suc: any) {
    this.sucursalSeleccionada = suc;
    this.cargando             = true;
    this.cargarProductos();
    this.cargarCategorias();
    this.cdr.detectChanges();
  }

  cambiarSucursal(id: number | null) {
    const suc = this.sucursales.find(s => s.id_sucursal === id);
    if (suc) this.seleccionarSucursal(suc);
  }

  get idSucursal(): number {
    return this.sucursalSeleccionada?.id_sucursal || 1;
  }

  // ─── PRODUCTOS ───
  cargarProductos() {
    this.productoService.obtenerInventario(this.idSucursal, true).subscribe({
      next: (datos) => {
        this.productos = datos;
        this.cargando  = false;
        this.aplicarFiltros();
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
    const texto = this.filtroBusqueda.toLowerCase();
    const f     = this.filtroEstado;
    this.productosFiltrados = this.productos.filter(p => {
      const porCat    = !this.filtroCategoria || p.id_categoria === this.filtroCategoria;
      const porNomb   = !texto || p.nombre_producto.toLowerCase().includes(texto);
      const porEstado = f === 'todos'
                        || (f === 'inactivos' && !p.estado_activo)
                        || (p.estado_activo && (f === 'activos' || this.estadoStock(p) === f));
      return porCat && porNomb && porEstado;
    });
    this.calcularResumen();
    this.cdr.detectChanges();
  }

  private calcularResumen() {
    const activos = this.productos.filter(p => p.estado_activo);
    this.resumen = {
      activos:  activos.length,
      bajos:    activos.filter(p => this.estadoStock(p) === 'bajo').length,
      agotados: activos.filter(p => this.estadoStock(p) === 'sin').length,
      valor:    activos.reduce((t, p) => t + Number(p.precio_unitario) * Math.max(Number(p.stock_actual) || 0, 0), 0)
    };
  }

  // Mismo criterio que el Panel: bajo = hasta el mínimo de alerta de la sucursal
  estadoStock(p: any): 'sin' | 'bajo' | 'ok' {
    const stock = Number(p.stock_actual) || 0;
    if (stock <= 0) return 'sin';
    return stock <= Number(p.stock_minimo_alerta ?? 0) ? 'bajo' : 'ok';
  }

  get categoriaActual(): any {
    return this.categorias.find(c => c.id_categoria === this.filtroCategoria) || null;
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
      precio_unitario: '', id_categoria: this.filtroCategoria || '',
      stock_inicial: 0
    };
    this.mostrarModal = true;
  }

  abrirModalEditar(prod: any) {
    this.editandoId    = prod.id_producto;
    this.errorModal    = '';
    this.archivoImagen = null;
    this.previewImagen = prod.url_imagen || null;
    this.formulario    = {
      nombre_producto:      prod.nombre_producto,
      descripcion_producto: prod.descripcion_producto || '',
      precio_unitario:      prod.precio_unitario,
      id_categoria:         prod.id_categoria,
      stock_inicial:        0
    };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.errorModal = ''; this.guardando = false; }

  onArchivoSeleccionado(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      this.errorModal = 'La imagen no debe superar 2 MB.'; this.cdr.detectChanges(); return;
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
      this.errorModal = 'Completa nombre, precio y categoría.'; return;
    }

    this.guardando  = true;
    this.errorModal = '';
    const datos = {
      nombre_producto:      this.formulario.nombre_producto,
      descripcion_producto: this.formulario.descripcion_producto || '',
      precio_unitario:      this.formulario.precio_unitario,
      id_categoria:         this.formulario.id_categoria
    };
    const fallo = (e: any, msg: string) => {
      this.errorModal = e?.error?.error || msg;
      this.guardando  = false;
      this.cdr.detectChanges();
    };

    if (this.editandoId) {
      // Editar: solo datos del producto, no el inventario
      this.productoService.actualizarProducto(this.editandoId, datos, this.archivoImagen || undefined).subscribe({
        next:  () => { this.cerrarModal(); this.avisar('Producto actualizado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo actualizar el producto.')
      });
    } else {
      // Crear: queda asignado a la sucursal elegida con su stock inicial
      const nuevo = { ...datos, id_sucursal: this.idSucursal, stock_inicial: this.formulario.stock_inicial || 0 };
      this.productoService.crearProducto(nuevo, this.archivoImagen || undefined).subscribe({
        next:  () => { this.cerrarModal(); this.avisar('Producto creado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo crear el producto.')
      });
    }
  }

  toggleEstadoProducto(prod: any) {
    const accion = prod.estado_activo
      ? this.productoService.desactivarProducto(prod.id_producto)
      : this.productoService.reactivarProducto(prod.id_producto);
    const texto  = prod.estado_activo ? 'desactivado' : 'reactivado';
    accion.subscribe({
      next:  () => { this.avisar(`«${prod.nombre_producto}» ${texto}`); this.cargarProductos(); },
      error: () => this.avisar(`No se pudo dejar el producto ${texto}.`)
    });
  }

  // ─── MODAL STOCK ───
  abrirModalStock(prod: any) {
    this.productoStock     = prod;
    this.cantidadAgregar   = 0;
    this.errorStock        = '';
    this.mostrarModalStock = true;
  }

  cerrarModalStock() { this.mostrarModalStock = false; this.productoStock = null; this.guardando = false; }

  agregarStock() {
    if (!this.cantidadAgregar || this.cantidadAgregar <= 0) {
      this.errorStock = 'Ingresa una cantidad válida.'; return;
    }
    this.guardando = true;
    const cantidad = this.cantidadAgregar;
    this.productoService.agregarStock(this.productoStock.id_producto, cantidad, this.idSucursal).subscribe({
      next:  () => { this.cerrarModalStock(); this.avisar(`Se agregaron ${cantidad} unidad(es)`); this.cargarProductos(); },
      error: (e: any) => {
        this.errorStock = e?.error?.error || 'No se pudo agregar el stock.';
        this.guardando  = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── MODAL CATEGORÍA ───
  abrirModalCategoria() { this.nombreCategoria = ''; this.errorCategoria = ''; this.mostrarModalCategoria = true; }
  cerrarModalCategoria() { this.mostrarModalCategoria = false; }

  crearCategoria() {
    if (!this.nombreCategoria.trim()) { this.errorCategoria = 'Escribe el nombre.'; return; }
    this.productoService.crearCategoria({ nombre_categoria: this.nombreCategoria, descripcion_categoria: '' }).subscribe({
      next:  () => { this.cerrarModalCategoria(); this.avisar('Categoría creada'); this.cargarCategorias(); },
      error: (e: any) => { this.errorCategoria = e?.error?.error || 'No se pudo crear la categoría.'; this.cdr.detectChanges(); }
    });
  }

  // ─── BORRAR CATEGORÍA ───
  abrirModalBorrarCategoria(cat: any) {
    this.catABorrar            = cat;
    this.productosBloqueantes  = this.productos.filter(p => p.id_categoria === cat.id_categoria);
    this.pasoBorradoCat        = 1;
    this.inputConfirmacionCat  = '';
    this.errorBorrarCat        = '';
    this.cargandoBorrarCat     = false;
    this.mostrarModalBorrarCat = true;
  }

  cerrarModalBorrarCategoria() {
    this.mostrarModalBorrarCat = false;
    this.catABorrar            = null;
    this.productosBloqueantes  = [];
    this.pasoBorradoCat        = 1;
    this.inputConfirmacionCat  = '';
    this.errorBorrarCat        = '';
  }

  avanzarBorradoCat() {
    if (this.productosBloqueantes.length > 0) return;
    this.pasoBorradoCat = 2;
    this.errorBorrarCat = '';
  }

  confirmarBorradoCategoria() {
    if (!this.catABorrar) return;
    if (this.inputConfirmacionCat.trim() !== this.catABorrar.nombre_categoria) {
      this.errorBorrarCat = 'El nombre no coincide.'; return;
    }
    this.cargandoBorrarCat = true;
    this.errorBorrarCat    = '';
    this.productoService.eliminarCategoria(this.catABorrar.id_categoria, this.inputConfirmacionCat).subscribe({
      next: () => {
        if (this.filtroCategoria === this.catABorrar.id_categoria) this.filtroCategoria = null;
        this.cerrarModalBorrarCategoria();
        this.avisar('Categoría eliminada');
        this.cargarCategorias();
        this.aplicarFiltros();
      },
      error: (e: any) => {
        this.cargandoBorrarCat = false;
        this.errorBorrarCat    = e?.error?.error || 'No se pudo eliminar la categoría.';
        this.cdr.detectChanges();
      }
    });
  }

  private avisar(msg: string) {
    this.notificacion = msg;
    this.cdr.detectChanges();
    setTimeout(() => { this.notificacion = null; this.cdr.detectChanges(); }, 3500);
  }
}
