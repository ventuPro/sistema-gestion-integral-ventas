import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ProductoService } from '../../../core/services/producto.service';
import { SocketService } from '../../../core/services/socket.service';
import { InventarioService, Movimiento, TipoMovimiento } from '../../../core/services/inventario.service';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule,
         Pencil, ArrowUpDown, RotateCw, Plus, Tag, Search, X, ImagePlus, Ban, History,
         ChevronUp, ChevronDown, ListOrdered, Star, ClipboardList, Trash2 } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { cifra } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';
import { comprimirImagen } from '../../../core/utils/imagen';
import { TransferenciasComponent } from './transferencias/transferencias.component';
import { ListaDiaComponent } from './lista-dia/lista-dia.component';
import { BarraCategoriasComponent } from '../../shared/barra-categorias/barra-categorias.component';
import { agruparPorCategoria } from '../../../core/utils/categorias';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';

type FiltroEstado = 'activos' | 'bajo' | 'sin' | 'inactivos' | 'todos';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent, ImagenUrlPipe, TransferenciasComponent,
            ListaDiaComponent, BarraCategoriasComponent],
  templateUrl: './inventario.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './inventario.component.css']
})
export class InventarioComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private productoService = inject(ProductoService);
  private dialogo         = inject(DialogoService);
  private socketService   = inject(SocketService);
  private inventarioService = inject(InventarioService);
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
    desactivar: Ban,
    subir:      ChevronUp,
    bajar:      ChevronDown,
    ordenar:    ListOrdered,
    destacado:  Star,
    listaDia:   ClipboardList,
    quitarCategoria: Trash2
  };

  readonly mostrarListaDia = signal(false);

  readonly filtrosEstado: { valor: FiltroEstado; texto: string }[] = [
    { valor: 'activos',   texto: 'Activos' },
    { valor: 'bajo',      texto: 'Stock bajo' },
    { valor: 'sin',       texto: 'Sin stock' },
    { valor: 'inactivos', texto: 'Inactivos' },
    { valor: 'todos',     texto: 'Todos' }
  ];

  // ─── Usuario y sucursales ───
  readonly esAdmin = this.sesion.esAdmin;
  readonly sucursales           = signal<any[]>([]);
  readonly sucursalSeleccionada = signal<any>(null);
  readonly idSucursal           = computed<number>(() => this.sucursalSeleccionada()?.id_sucursal || 1);

  // ─── Productos e inventario ───
  readonly productos  = signal<any[]>([]);
  readonly categorias = signal<any[]>([]);
  readonly cargando   = signal(true);
  readonly guardando  = signal(false);

  // ─── Filtros ───
  readonly filtroBusqueda  = signal('');
  readonly filtroEstado    = signal<FiltroEstado>('activos');

  readonly productosFiltrados = computed(() => {
    const texto = this.filtroBusqueda().toLowerCase(), f = this.filtroEstado();
    return this.productos().filter(p => {
      const porNomb   = !texto || p.nombre_producto.toLowerCase().includes(texto);
      const porEstado = f === 'todos'
                        || (f === 'inactivos' && !p.estado_activo)
                        || (p.estado_activo && (f === 'activos' || this.estadoStock(p) === f));
      return porNomb && porEstado;
    });
  });

  /** Por categoría en el orden del menú; en cada una, primero los que tienen stock */
  readonly secciones = computed(() => agruparPorCategoria(this.productosFiltrados()));
  readonly barra = computed(() => this.secciones().map(s => ({ id: s.id, nombre: s.nombre, icono: s.icono, cantidad: s.productos.length })));

  // Formularios de los modales: se reemplazan con set(); el template edita los campos del objeto actual

  // ─── Modal Producto ───
  readonly mostrarModal  = signal(false);
  readonly editandoId    = signal<number | null>(null);
  readonly errorModal    = signal('');
  private fotoNueva: string | null = null;
  readonly procesandoFoto = signal(false);
  readonly previewImagen = signal<string | null>(null);
  readonly formulario    = signal<any>({
    nombre_producto: '', descripcion_producto: '',
    precio_unitario: '', id_categoria: '',
    ingredientes: '', preparacion: '', destacado: false, mostrar_en_menu: true,
    stock_inicial: null
  });

  // ─── Modal movimiento (entrada o merma) ───
  readonly productoMov = signal<any>(null);
  readonly mov         = signal({ tipo: 'INGRESO' as TipoMovimiento, cantidad: null as number | null, motivo: '', detalle: '' });
  readonly motivos     = signal<Record<TipoMovimiento, string[]>>({ INGRESO: [], SALIDA: [] });
  readonly errorMov    = signal('');

  // ─── Pestaña Movimientos ───
  readonly vista             = signal<'productos' | 'movimientos' | 'transferencias'>('productos');
  readonly movimientos       = signal<Movimiento[]>([]);
  readonly cargandoMov       = signal(false);
  readonly periodoMov        = signal<'hoy' | '7' | '30'>('7');
  readonly tipoMov           = signal<TipoMovimiento | null>(null);
  readonly productoFiltroMov = signal<{ id_producto: number; nombre_producto: string } | null>(null);
  private recargaMov: any;
  private recargaProductos: any;

  // ─── Modal Categoría ───
  readonly mostrarModalCategoria = signal(false);
  readonly nombreCategoria       = signal('');
  readonly errorCategoria        = signal('');

  // ─── Borrado de categoría (doble confirmación) ───
  readonly mostrarModalBorrarCat = signal(false);
  readonly catABorrar            = signal<any>(null);
  readonly productosBloqueantes  = signal<any[]>([]);
  readonly pasoBorradoCat        = signal(1);
  readonly inputConfirmacionCat  = signal('');
  readonly errorBorrarCat        = signal('');
  readonly cargandoBorrarCat     = signal(false);

  ngOnInit() {
    this.cargarSucursales();
    this.suscribirStock();
  }

  ngOnDestroy() { this.stockSub?.unsubscribe(); clearTimeout(this.recargaMov); clearTimeout(this.recargaProductos); }

  // Ventas de POS, mesas y menú QR actualizan el stock sin recargar
  private suscribirStock() {
    this.socketService.conectar('cajeros');
    this.stockSub = this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (!p || Number(p.id_sucursal) !== this.idSucursal()) return;
      // Un producto que la sucursal no tenía (llegó por transferencia): se recarga la lista
      if (!this.fijarStock(Number(p.id_producto), Number(p.nueva_cantidad_disponible) || 0)) {
        clearTimeout(this.recargaProductos);
        this.recargaProductos = setTimeout(() => this.cargarProductos(), 400);
        return;
      }
      if (this.vista() === 'movimientos') {
        clearTimeout(this.recargaMov);
        this.recargaMov = setTimeout(() => this.cargarMovimientos(), 600);
      }
    });
  }

  /** Cambia el stock de un producto de la lista; false si no está en ella */
  private fijarStock(id_producto: number, stock: number): boolean {
    if (!this.productos().some(x => Number(x.id_producto) === id_producto)) return false;
    this.productos.update(ps => ps.map(x => Number(x.id_producto) === id_producto ? { ...x, stock_actual: stock } : x));
    return true;
  }

  // ─── SUCURSALES ───
  cargarSucursales() {
    if (!this.esAdmin()) { this.usarSucursalPropia(); return; }
    this.http.get<any[]>(`${this.apiUrl}/sucursales`).subscribe({
      next: (suc) => {
        this.sucursales.set(suc || []);
        if (this.sucursales().length > 0 && !this.sucursalSeleccionada()) {
          this.seleccionarSucursal(this.sucursales()[0]);
        } else if (this.sucursales().length === 0) {
          this.usarSucursalPropia();
        }
      },
      error: () => this.usarSucursalPropia()
    });
  }

  private usarSucursalPropia() {
    this.sucursalSeleccionada.set({
      id_sucursal:     this.sesion.idSucursal(),
      nombre_sucursal: this.sesion.usuario()?.nombre_sucursal || 'Mi Sucursal'
    });
    this.cargarProductos();
    this.cargarCategorias();
  }

  seleccionarSucursal(suc: any) {
    this.sucursalSeleccionada.set(suc);
    this.cargando.set(true);
    this.productoFiltroMov.set(null);
    this.cargarProductos();
    this.cargarCategorias();
    if (this.vista() === 'movimientos') this.cargarMovimientos();
  }

  cambiarSucursal(id: number | null) {
    const suc = this.sucursales().find(s => s.id_sucursal === id);
    if (suc) this.seleccionarSucursal(suc);
  }

  // ─── PRODUCTOS ───
  cargarProductos() {
    this.productoService.obtenerInventario(this.idSucursal(), true).subscribe({
      next: (datos) => {
        this.productos.set(datos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
  }

  cargarCategorias() {
    this.productoService.obtenerCategorias().subscribe({
      next: (c) => this.categorias.set(c)
    });
  }

  // ─── FILTROS ───
  // Mismo criterio que el Panel: bajo = hasta el mínimo de alerta de la sucursal
  estadoStock(p: any): 'sin' | 'bajo' | 'ok' {
    const stock = Number(p.stock_actual) || 0;
    if (stock <= 0) return 'sin';
    return stock <= Number(p.stock_minimo_alerta ?? 0) ? 'bajo' : 'ok';
  }


  // ─── MODAL PRODUCTO ───
  abrirModalNuevo() {
    this.editandoId.set(null);
    this.errorModal.set('');
    this.fotoNueva = null;
    this.previewImagen.set(null);
    this.formulario.set({
      nombre_producto: '', descripcion_producto: '',
      precio_unitario: '', id_categoria: '',
      ingredientes: '', preparacion: '', destacado: false, mostrar_en_menu: true,
      stock_inicial: null
    });
    this.mostrarModal.set(true);
  }

  abrirModalEditar(prod: any) {
    this.editandoId.set(prod.id_producto);
    this.errorModal.set('');
    this.fotoNueva = null;
    this.previewImagen.set(prod.url_imagen || null);
    this.formulario.set({
      nombre_producto:      prod.nombre_producto,
      descripcion_producto: prod.descripcion_producto || '',
      precio_unitario:      prod.precio_unitario,
      id_categoria:         prod.id_categoria,
      ingredientes:         prod.ingredientes || '',
      preparacion:          prod.preparacion || '',
      destacado:            !!prod.destacado,
      mostrar_en_menu:      prod.mostrar_en_menu !== false,
      stock_inicial:        null
    });
    this.mostrarModal.set(true);
  }

  cerrarModal() { this.mostrarModal.set(false); this.editandoId.set(null); this.errorModal.set(''); this.guardando.set(false); }

  async onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.errorModal.set('');
    this.procesandoFoto.set(true);
    try {
      this.fotoNueva = await comprimirImagen(file);
      this.previewImagen.set(this.fotoNueva);
    } catch (e: any) {
      this.errorModal.set(e?.message || 'No se pudo leer la imagen.');
    } finally {
      this.procesandoFoto.set(false);
    }
  }

  guardarProducto() {
    const f = this.formulario(), id = this.editandoId();
    if (!f.nombre_producto || !f.precio_unitario || !f.id_categoria)
      return this.errorModal.set('Completa nombre, precio y categoría.');

    this.guardando.set(true);
    this.errorModal.set('');
    const datos = {
      nombre_producto:      f.nombre_producto,
      descripcion_producto: f.descripcion_producto || '',
      precio_unitario:      f.precio_unitario,
      id_categoria:         f.id_categoria,
      ingredientes:         f.ingredientes || '',
      preparacion:          f.preparacion || '',
      destacado:            !!f.destacado,
      mostrar_en_menu:      f.mostrar_en_menu !== false
    };
    const fallo = (e: any, msg: string) => {
      this.errorModal.set(e?.error?.error || msg);
      this.guardando.set(false);
    };

    if (id) {
      // Editar: solo datos del producto, no el inventario
      this.productoService.actualizarProducto(id, datos, this.fotoNueva).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Producto actualizado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo actualizar el producto.')
      });
    } else {
      // Crear: queda asignado a la sucursal elegida con su stock inicial
      const nuevo = { ...datos, id_sucursal: this.idSucursal(), stock_inicial: f.stock_inicial || 0 };
      this.productoService.crearProducto(nuevo, this.fotoNueva).subscribe({
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
    this.productoMov.set(prod);
    this.errorMov.set('');
    this.guardando.set(false);
    this.mov.set({ tipo: 'INGRESO', cantidad: null, motivo: '', detalle: '' });
    this.inventarioService.motivos$.subscribe({
      next:  (m) => { this.motivos.set(m); this.cambiarTipoMov(this.mov().tipo); },
      error: () => this.errorMov.set('No se pudieron cargar los motivos.')
    });
  }

  cambiarTipoMov(tipo: TipoMovimiento) {
    this.mov.update(m => ({ ...m, tipo, motivo: this.motivos()[tipo]?.[0] || '' }));
    this.errorMov.set('');
  }

  cerrarMovimiento() { this.productoMov.set(null); this.guardando.set(false); }

  get stockTrasMovimiento(): number {
    const mov = this.mov(), n = Math.trunc(Number(mov.cantidad)) || 0;
    return (Number(this.productoMov()?.stock_actual) || 0) + (mov.tipo === 'SALIDA' ? -n : n);
  }

  guardarMovimiento() {
    const cantidad = Number(this.mov().cantidad);
    const detalle  = this.mov().detalle.trim();
    if (!Number.isInteger(cantidad) || cantidad < 1) return this.errorMov.set('La cantidad debe ser un número entero mayor a 0.');
    if (this.stockTrasMovimiento < 0) return this.errorMov.set(`Solo hay ${this.productoMov().stock_actual || 0} en stock.`);
    if (this.mov().motivo === 'Otro' && !detalle) return this.errorMov.set('Describe el motivo en la observación.');

    const prod = this.productoMov();
    this.guardando.set(true);
    this.inventarioService.registrar({
      id_producto: prod.id_producto, id_sucursal: this.idSucursal(),
      tipo: this.mov().tipo, cantidad, motivo: this.mov().motivo, detalle: detalle || undefined
    }).subscribe({
      next: (r) => {
        this.fijarStock(Number(prod.id_producto), r.stock_actual);
        this.cerrarMovimiento();
        this.dialogo.avisar(`${this.mov().tipo === 'INGRESO' ? 'Entrada' : 'Merma'} registrada: ${prod.nombre_producto} queda en ${r.stock_actual}`);
        if (this.vista() === 'movimientos') this.cargarMovimientos();
      },
      error: (e: any) => {
        this.errorMov.set(e?.error?.error || 'No se pudo registrar el movimiento.');
        this.guardando.set(false);
      }
    });
  }

  // ─── PESTAÑA MOVIMIENTOS ───
  verMovimientos(prod?: any) {
    this.productoFiltroMov.set(prod ? { id_producto: prod.id_producto, nombre_producto: prod.nombre_producto } : null);
    this.vista.set('movimientos');
    this.cargarMovimientos();
  }

  cargarMovimientos() {
    const dias  = { hoy: 0, '7': 6, '30': 29 }[this.periodoMov()];
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    this.cargandoMov.set(true);
    this.inventarioService.listar({
      id_sucursal: this.idSucursal(), id_producto: this.productoFiltroMov()?.id_producto,
      tipo: this.tipoMov(), desde: desde.toLocaleDateString('en-CA')   // AAAA-MM-DD en hora local
    }).subscribe({
      next:  (m) => { this.movimientos.set(m); this.cargandoMov.set(false); },
      error: () => { this.movimientos.set([]); this.cargandoMov.set(false); this.dialogo.error('No se pudo cargar el historial.'); }
    });
  }

  // ─── MODAL CATEGORÍA ───
  abrirModalCategoria() { this.nombreCategoria.set(''); this.errorCategoria.set(''); this.mostrarModalCategoria.set(true); }
  cerrarModalCategoria() { this.mostrarModalCategoria.set(false); }

  crearCategoria() {
    if (!this.nombreCategoria().trim()) return this.errorCategoria.set('Escribe el nombre.');
    this.productoService.crearCategoria({ nombre_categoria: this.nombreCategoria(), descripcion_categoria: '' }).subscribe({
      next:  () => { this.cerrarModalCategoria(); this.dialogo.avisar('Categoría creada'); this.cargarCategorias(); },
      error: (e: any) => this.errorCategoria.set(e?.error?.error || 'No se pudo crear la categoría.')
    });
  }

  // ─── ORDEN DE CATEGORÍAS EN EL MENÚ QR ───
  readonly ordenCategorias  = signal<any[] | null>(null);
  readonly guardandoOrden   = signal(false);

  abrirOrdenCategorias() { this.ordenCategorias.set([...this.categorias()]); }

  moverCategoria(i: number, paso: -1 | 1) {
    this.ordenCategorias.update(lista => {
      const j = i + paso;
      if (!lista || j < 0 || j >= lista.length) return lista;
      const copia = [...lista];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }

  guardarOrdenCategorias() {
    const lista = this.ordenCategorias();
    if (!lista) return;
    this.guardandoOrden.set(true);
    this.productoService.ordenarCategorias(lista.map(c => c.id_categoria)).subscribe({
      next: (c) => {
        this.categorias.set(c);
        this.guardandoOrden.set(false);
        this.ordenCategorias.set(null);
        this.dialogo.avisar('Orden guardado');
      },
      error: (e: any) => {
        this.guardandoOrden.set(false);
        this.dialogo.error(e?.error?.error || 'No se pudo guardar el orden.');
      }
    });
  }

  // ─── BORRAR CATEGORÍA ───
  abrirModalBorrarCategoria(cat: any) {
    this.catABorrar.set(cat);
    this.productosBloqueantes.set(this.productos().filter(p => p.id_categoria === cat.id_categoria));
    this.pasoBorradoCat.set(1);
    this.inputConfirmacionCat.set('');
    this.errorBorrarCat.set('');
    this.cargandoBorrarCat.set(false);
    this.mostrarModalBorrarCat.set(true);
  }

  cerrarModalBorrarCategoria() {
    this.mostrarModalBorrarCat.set(false);
    this.catABorrar.set(null);
    this.productosBloqueantes.set([]);
    this.pasoBorradoCat.set(1);
    this.inputConfirmacionCat.set('');
    this.errorBorrarCat.set('');
  }

  avanzarBorradoCat() {
    if (this.productosBloqueantes().length > 0) return;
    this.pasoBorradoCat.set(2);
    this.errorBorrarCat.set('');
  }

  confirmarBorradoCategoria() {
    const cat = this.catABorrar();
    if (!cat) return;
    if (this.inputConfirmacionCat().trim() !== cat.nombre_categoria) return this.errorBorrarCat.set('El nombre no coincide.');
    this.cargandoBorrarCat.set(true);
    this.errorBorrarCat.set('');
    this.productoService.eliminarCategoria(cat.id_categoria, this.inputConfirmacionCat()).subscribe({
      next: () => {
        this.cerrarModalBorrarCategoria();
        this.dialogo.avisar('Categoría eliminada');
        this.cargarCategorias();
      },
      error: (e: any) => {
        this.cargandoBorrarCat.set(false);
        this.errorBorrarCat.set(e?.error?.error || 'No se pudo eliminar la categoría.');
      }
    });
  }
}
