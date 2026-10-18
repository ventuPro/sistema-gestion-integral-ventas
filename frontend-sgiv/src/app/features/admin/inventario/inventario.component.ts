import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ProductoService } from '../../../core/services/producto.service';
import { SocketService } from '../../../core/services/socket.service';
import { InventarioService, Movimiento, TipoMovimiento } from '../../../core/services/inventario.service';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule,
         Pencil, ArrowUpDown, RotateCw, Plus, Tag, Search, X, ImagePlus, Ban, History } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { cifra } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';

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
  private dialogo         = inject(DialogoService);
  private socketService   = inject(SocketService);
  private inventarioService = inject(InventarioService);
  private cdr             = inject(ChangeDetectorRef);
  readonly moneda          = inject(AjustesService).moneda;
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;
  private stockSub?:      Subscription;
  readonly cifra          = cifra;

  // ─── Iconos ───
  readonly icons = {
    edit:       Pencil,
    movimiento: ArrowUpDown,
    historial:  History,
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

  // ─── Modal movimiento (entrada o merma) ───
  productoMov:           any = null;
  mov = { tipo: 'INGRESO' as TipoMovimiento, cantidad: 0, motivo: '', detalle: '' };
  motivos: Record<TipoMovimiento, string[]> = { INGRESO: [], SALIDA: [] };
  errorMov               = '';

  // ─── Pestaña Movimientos ───
  vista: 'productos' | 'movimientos' = 'productos';
  movimientos:           Movimiento[] = [];
  cargandoMov            = false;
  periodoMov: 'hoy' | '7' | '30' = '7';
  tipoMov:               TipoMovimiento | null = null;
  productoFiltroMov:     { id_producto: number; nombre_producto: string } | null = null;
  private recargaMov:    any;

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

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;

    this.cargarSucursales();
    this.suscribirStock();
  }

  ngOnDestroy() { this.stockSub?.unsubscribe(); clearTimeout(this.recargaMov); }

  // Ventas de POS, mesas y menú QR actualizan el stock sin recargar
  private suscribirStock() {
    this.socketService.conectar('cajeros');
    this.stockSub = this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (!p || Number(p.id_sucursal) !== this.idSucursal) return;
      const prod = this.productos.find(x => Number(x.id_producto) === Number(p.id_producto));
      if (!prod) return;
      prod.stock_actual = Number(p.nueva_cantidad_disponible) || 0;
      this.aplicarFiltros();
      if (this.vista === 'movimientos') {
        clearTimeout(this.recargaMov);
        this.recargaMov = setTimeout(() => this.cargarMovimientos(), 600);
      }
    });
  }

  // ─── SUCURSALES ───
  cargarSucursales() {
    if (!this.esAdmin) { this.usarSucursalPropia(); return; }
    this.http.get<any[]>(`${this.apiUrl}/sucursales`).subscribe({
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
    this.productoFiltroMov    = null;
    this.cargarProductos();
    this.cargarCategorias();
    if (this.vista === 'movimientos') this.cargarMovimientos();
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
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Producto actualizado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo actualizar el producto.')
      });
    } else {
      // Crear: queda asignado a la sucursal elegida con su stock inicial
      const nuevo = { ...datos, id_sucursal: this.idSucursal, stock_inicial: this.formulario.stock_inicial || 0 };
      this.productoService.crearProducto(nuevo, this.archivoImagen || undefined).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Producto creado'); this.cargarProductos(); },
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
      next:  () => { this.dialogo.avisar(`«${prod.nombre_producto}» ${texto}`); this.cargarProductos(); },
      error: () => this.dialogo.error(`No se pudo dejar el producto ${texto}.`)
    });
  }

  // ─── MOVIMIENTO (entrada o merma) ───
  abrirMovimiento(prod: any) {
    this.productoMov = prod;
    this.errorMov    = '';
    this.guardando   = false;
    this.mov         = { tipo: 'INGRESO', cantidad: 0, motivo: '', detalle: '' };
    this.inventarioService.motivos$.subscribe({
      next:  (m) => { this.motivos = m; this.cambiarTipoMov(this.mov.tipo); this.cdr.detectChanges(); },
      error: () => { this.errorMov = 'No se pudieron cargar los motivos.'; this.cdr.detectChanges(); }
    });
  }

  cambiarTipoMov(tipo: TipoMovimiento) {
    this.mov.tipo   = tipo;
    this.mov.motivo = this.motivos[tipo]?.[0] || '';
    this.errorMov   = '';
  }

  cerrarMovimiento() { this.productoMov = null; this.guardando = false; }

  get stockTrasMovimiento(): number {
    const n = Math.trunc(Number(this.mov.cantidad)) || 0;
    return (Number(this.productoMov?.stock_actual) || 0) + (this.mov.tipo === 'SALIDA' ? -n : n);
  }

  guardarMovimiento() {
    const cantidad = Number(this.mov.cantidad);
    const detalle  = this.mov.detalle.trim();
    if (!Number.isInteger(cantidad) || cantidad < 1) { this.errorMov = 'La cantidad debe ser un número entero mayor a 0.'; return; }
    if (this.stockTrasMovimiento < 0) { this.errorMov = `Solo hay ${this.productoMov.stock_actual || 0} en stock.`; return; }
    if (this.mov.motivo === 'Otro' && !detalle) { this.errorMov = 'Describe el motivo en la observación.'; return; }

    const prod = this.productoMov;
    this.guardando = true;
    this.inventarioService.registrar({
      id_producto: prod.id_producto, id_sucursal: this.idSucursal,
      tipo: this.mov.tipo, cantidad, motivo: this.mov.motivo, detalle: detalle || undefined
    }).subscribe({
      next: (r) => {
        prod.stock_actual = r.stock_actual;
        this.cerrarMovimiento();
        this.dialogo.avisar(`${this.mov.tipo === 'INGRESO' ? 'Entrada' : 'Merma'} registrada: ${prod.nombre_producto} queda en ${r.stock_actual}`);
        this.aplicarFiltros();
        if (this.vista === 'movimientos') this.cargarMovimientos();
      },
      error: (e: any) => {
        this.errorMov  = e?.error?.error || 'No se pudo registrar el movimiento.';
        this.guardando = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── PESTAÑA MOVIMIENTOS ───
  verMovimientos(prod?: any) {
    this.productoFiltroMov = prod ? { id_producto: prod.id_producto, nombre_producto: prod.nombre_producto } : null;
    this.vista = 'movimientos';
    this.cargarMovimientos();
  }

  cargarMovimientos() {
    const dias  = { hoy: 0, '7': 6, '30': 29 }[this.periodoMov];
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    this.cargandoMov = true;
    this.inventarioService.listar({
      id_sucursal: this.idSucursal, id_producto: this.productoFiltroMov?.id_producto,
      tipo: this.tipoMov, desde: desde.toLocaleDateString('en-CA')   // AAAA-MM-DD en hora local
    }).subscribe({
      next:  (m) => { this.movimientos = m; this.cargandoMov = false; this.cdr.detectChanges(); },
      error: () => { this.movimientos = []; this.cargandoMov = false; this.dialogo.error('No se pudo cargar el historial.'); }
    });
  }

  // ─── MODAL CATEGORÍA ───
  abrirModalCategoria() { this.nombreCategoria = ''; this.errorCategoria = ''; this.mostrarModalCategoria = true; }
  cerrarModalCategoria() { this.mostrarModalCategoria = false; }

  crearCategoria() {
    if (!this.nombreCategoria.trim()) { this.errorCategoria = 'Escribe el nombre.'; return; }
    this.productoService.crearCategoria({ nombre_categoria: this.nombreCategoria, descripcion_categoria: '' }).subscribe({
      next:  () => { this.cerrarModalCategoria(); this.dialogo.avisar('Categoría creada'); this.cargarCategorias(); },
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
        this.dialogo.avisar('Categoría eliminada');
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
}
