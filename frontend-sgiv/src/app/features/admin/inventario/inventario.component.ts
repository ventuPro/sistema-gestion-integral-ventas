import { firstValueFrom } from 'rxjs';
import { Component, computed, inject, OnInit, OnDestroy, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ProductoParecido, ProductoService } from '../../../core/services/producto.service';
import { SocketService } from '../../../core/services/socket.service';
import { InventarioService, Movimiento, TipoMovimiento } from '../../../core/services/inventario.service';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule,
         Pencil, ArrowUpDown, RotateCw, Plus, Tag, Search, X, ImagePlus, Ban, History,
         ChevronUp, ChevronDown, ListOrdered, Star, Download, Trash2, PackagePlus, CalendarX, CopyPlus } from 'lucide-angular';
import { AjustesService } from '../../../core/services/ajustes.service';
import { CostoService, Receta } from '../../../core/services/costo.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { cifra } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';
import { PermisoService } from '../../../core/services/permiso.service';
import { SesionService } from '../../../core/services/sesion.service';
import { comprimirImagen } from '../../../core/utils/imagen';
import { TransferenciasComponent } from './transferencias/transferencias.component';
import { DescargaInventarioComponent } from './descarga-inventario/descarga-inventario.component';
import { IngresosDiaComponent } from './ingresos-dia/ingresos-dia.component';
import { VencidosComponent } from './vencidos/vencidos.component';
import { AgregarExistenteComponent } from './agregar-existente/agregar-existente.component';
import { BarraCategoriasComponent } from '../../shared/barra-categorias/barra-categorias.component';
import { agruparPorCategoria } from '../../../core/utils/categorias';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';

type FiltroEstado = 'activos' | 'bajo' | 'sin' | 'vence' | 'inactivos' | 'todos';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent, ImagenUrlPipe, TransferenciasComponent,
            DescargaInventarioComponent, IngresosDiaComponent, VencidosComponent, AgregarExistenteComponent, BarraCategoriasComponent],
  templateUrl: './inventario.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './inventario.component.css']
})
export class InventarioComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private readonly permisos = inject(PermisoService);
  private productoService = inject(ProductoService);
  private dialogo         = inject(DialogoService);
  private socketService   = inject(SocketService);
  private inventarioService = inject(InventarioService);
  private ajustes         = inject(AjustesService);
  private costos          = inject(CostoService);
  readonly moneda          = this.ajustes.moneda;

  // Tipo de producto: elaborado (vence en horas), preparado al momento (sin stock) o comprado (vence en días)
  readonly tipos = [
    { valor: 'ELABORADO', texto: 'Elaborado' },
    { valor: 'PREPARADO', texto: 'Preparado al momento' },
    { valor: 'COMPRADO',  texto: 'Comprado' }
  ];
  readonly esPreparado = (p: any) => p?.tipo_producto === 'PREPARADO';
  /** Vida útil por defecto en la unidad del tipo (horas o días) */
  vidaPorDefecto(tipo: string): number {
    const c = this.ajustes.config();
    return tipo === 'COMPRADO' ? c.vida_util_comprado_dias ?? 180 : c.vida_util_elaborado_horas ?? 48;
  }
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;
  private stockSub?:      Subscription;
  private reconexionSub?: Subscription;
  readonly cifra          = cifra;

  // ─── Menús de la cabecera (Categorías y la flecha de «Nuevo producto») ───
  readonly menuCabecera = signal<'categorias' | 'nuevo' | null>(null);

  alternarMenu(menu: 'categorias' | 'nuevo', evento: Event) {
    evento.stopPropagation();
    this.menuCabecera.update(m => m === menu ? null : menu);
  }

  /** Elegir una opción cierra el menú */
  elegirMenu(accion: () => void) {
    this.menuCabecera.set(null);
    accion();
  }

  readonly abrirAgregarExistente = () => this.mostrarAgregarExistente.set(true);

  @HostListener('document:click')
  cerrarMenuCabecera() { if (this.menuCabecera()) this.menuCabecera.set(null); }

  @HostListener('document:keydown.escape')
  cerrarMenuConEsc() { this.cerrarMenuCabecera(); }

  // ─── Iconos ───
  readonly icons = {
    edit:       Pencil,
    movimiento: ArrowUpDown,
    historial:  History,
    refresh:    RotateCw,
    mas:        Plus,
    agregarExistente: CopyPlus,
    etiqueta:   Tag,
    buscar:     Search,
    cerrar:     X,
    imagen:     ImagePlus,
    desactivar: Ban,
    subir:      ChevronUp,
    bajar:      ChevronDown,
    ordenar:    ListOrdered,
    destacado:  Star,
    descargar:  Download,
    ingresos:   PackagePlus,
    vencidos:   CalendarX,
    quitarCategoria: Trash2
  };

  readonly mostrarDescarga = signal(false);
  readonly mostrarIngresos = signal(false);
  readonly mostrarVencidos = signal(false);
  readonly mostrarAgregarExistente = signal(false);
  /** Unidades vencidas en la sucursal (número del botón «Vencidos») */
  readonly totalVencidos = computed(() => this.productos().reduce((s, p) => s + (Number(p.vencidos) || 0), 0));

  readonly filtrosEstado: { valor: FiltroEstado; texto: string }[] = [
    { valor: 'activos',   texto: 'Activos' },
    { valor: 'bajo',      texto: 'Stock bajo' },
    { valor: 'sin',       texto: 'Sin stock' },
    { valor: 'vence',     texto: 'Por vencer o vencidos' },
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
                        || (f === 'vence' && (p.vencidos > 0 || p.por_vencer > 0))
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
    tipo_producto: 'ELABORADO', vida_util: null, stock_inicial: null, id_receta: null
  });
  private tipoAntes = 'ELABORADO';

  // ─── Modal movimiento (entrada o merma) ───
  readonly productoMov = signal<any>(null);
  readonly mov         = signal({ tipo: 'INGRESO' as TipoMovimiento, cantidad: null as number | null, motivo: '', detalle: '', vence: '',
                                  costo: null as number | null });
  readonly hoy         = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  readonly motivos     = signal<Record<TipoMovimiento, string[]>>({ INGRESO: [], SALIDA: [] });
  readonly errorMov    = signal('');
  /** Producción repartida a otras sucursales (permiso «reparto»): cantidad por sucursal, se edita en el lugar */
  readonly reparto     = signal<{ id_sucursal: number; nombre_sucursal: string; cantidad: number | null }[]>([]);

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

  ngOnDestroy() { this.stockSub?.unsubscribe(); this.reconexionSub?.unsubscribe(); clearTimeout(this.recargaMov); clearTimeout(this.recargaProductos); }

  // Ventas de POS, mesas y menú QR actualizan el stock sin recargar
  private suscribirStock() {
    this.socketService.conectar('cajeros');
    // Tras un corte de conexión: stock al día
    this.reconexionSub = this.socketService.reconexiones.subscribe(() => this.cargarProductos());
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
    if (this.esPreparado(p)) return 'ok';
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
      tipo_producto: 'ELABORADO', vida_util: null, stock_inicial: null, id_receta: null
    });
    this.tipoAntes = 'ELABORADO';
    this.parecidos.set([]);
    this.cargarRecetas(null);
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
      tipo_producto:        prod.tipo_producto || 'ELABORADO',
      vida_util:            prod.vida_util_horas ? (prod.tipo_producto === 'COMPRADO' ? prod.vida_util_horas / 24 : prod.vida_util_horas) : null,
      stock_inicial:        null,
      id_receta:            null
    });
    this.tipoAntes = prod.tipo_producto || 'ELABORADO';
    this.parecidos.set([]);
    this.cargarRecetas(Number(prod.id_producto));
    this.mostrarModal.set(true);
  }

  cerrarModal() {
    this.mostrarModal.set(false); this.editandoId.set(null); this.errorModal.set(''); this.guardando.set(false);
    this.parecidos.set([]); clearTimeout(this.esperaParecidos);
  }

  // ─── Productos con nombre parecido (contra duplicados con otro nombre) ───
  readonly parecidos = signal<ProductoParecido[]>([]);
  private esperaParecidos?: ReturnType<typeof setTimeout>;

  buscarParecidos(nombre: string) {
    clearTimeout(this.esperaParecidos);
    const texto = (nombre || '').trim();
    if (texto.length < 3) return this.parecidos.set([]);
    this.esperaParecidos = setTimeout(() => {
      this.productoService.parecidos(texto, this.idSucursal(), this.editandoId()).subscribe({
        next: (l) => { if (this.mostrarModal() && this.formulario().nombre_producto.trim() === texto) this.parecidos.set(l); },
        error: () => this.parecidos.set([])
      });
    }, 300);
  }

  /** Usar el producto que ya existe: se agrega a esta sucursal con el stock inicial escrito */
  async usarExistente(p: ProductoParecido) {
    const stock = Number(this.formulario().stock_inicial) || 0;
    if (!(await this.dialogo.confirmar({
      titulo: `¿Agregar «${p.nombre_producto}» a ${this.sucursalSeleccionada()?.nombre_sucursal || 'esta sucursal'}?`,
      mensaje: `Se usa el producto que ya existe${stock ? ` con ${stock} de stock inicial` : ''} y no se crea otro.`,
      textoConfirmar: 'Agregar'
    }))) return;
    this.productoService.agregarASucursal(this.idSucursal(), [{ id_producto: p.id_producto, stock_inicial: stock }]).subscribe({
      next: () => { this.cerrarModal(); this.dialogo.avisar(`${p.nombre_producto} agregado`); this.cargarProductos(); },
      error: (e: any) => this.errorModal.set(e?.error?.error || 'No se pudo agregar el producto.')
    });
  }

  /** Ya está en esta sucursal: se cierra la ventana y se busca en la lista */
  verExistente(p: ProductoParecido) {
    this.cerrarModal();
    this.filtroEstado.set(p.estado_activo ? 'activos' : 'inactivos');
    this.filtroBusqueda.set(p.nombre_producto);
  }

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

  // ─── Receta del producto (de Costos): de ahí sale su costo ───
  readonly recetas = signal<Receta[]>([]);

  /** Solo el administrador; al editar, marca la receta que ya tiene el producto */
  private cargarRecetas(id_producto: number | null) {
    if (!this.esAdmin()) return;
    this.costos.recetas().subscribe({
      next: (r) => {
        this.recetas.set(r);
        const suya = id_producto ? r.find(x => x.id_producto === id_producto)?.id_receta ?? null : null;
        if (this.mostrarModal() && this.editandoId() === id_producto) this.formulario.update(f => ({ ...f, id_receta: suya }));
      }
    });
  }

  /** Receta elegida y lo que deja con el precio escrito (el precio lo decide el propietario) */
  recetaActual(): { receta: Receta; costo: number; ganancia: number | null; margen: number | null } | null {
    const f = this.formulario();
    const receta = this.recetas().find(r => r.id_receta === f.id_receta);
    if (!receta) return null;
    const precio = Number(f.precio_unitario) || 0;
    const ganancia = precio ? precio - receta.por_unidad : null;
    return { receta, costo: receta.por_unidad, ganancia, margen: ganancia == null ? null : ganancia * 100 / precio };
  }

  /** Una receta que ya es de otro producto no se puede elegir */
  recetaDeOtro(r: Receta): boolean { return !!r.id_producto && r.id_producto !== this.editandoId(); }

  /** Al cambiar el tipo, la vida útil vuelve a la de Ajustes (cambia la unidad) */
  cambiarTipo(tipo: string) {
    this.formulario.update(f => ({ ...f, tipo_producto: tipo, vida_util: null }));
  }

  async guardarProducto(confirmar_parecido = false) {
    const f = this.formulario(), id = this.editandoId();
    if (!f.nombre_producto || !f.precio_unitario || !f.id_categoria)
      return this.errorModal.set('Completa nombre, precio y categoría.');
    if (!confirmar_parecido && id && f.tipo_producto === 'PREPARADO' && this.tipoAntes !== 'PREPARADO' && !(await this.dialogo.confirmar({
      titulo: '¿Pasar a «Preparado al momento»?', textoConfirmar: 'Cambiar', peligro: true,
      advertencias: ['Su stock de todas las sucursales sale como «Ajuste de conteo».',
                     'Desde ahora se vende siempre, sin stock ni lotes.']
    }))) return;
    const vida = Number(f.vida_util) || null;
    const vida_util_horas = f.tipo_producto === 'PREPARADO' || !vida ? null
                          : Math.round(f.tipo_producto === 'COMPRADO' ? vida * 24 : vida);

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
      mostrar_en_menu:      f.mostrar_en_menu !== false,
      tipo_producto:        f.tipo_producto,
      vida_util_horas,
      // La receta la elige solo el administrador (lo comprado toma el costo de la compra)
      ...(this.esAdmin() ? { id_receta: f.tipo_producto === 'COMPRADO' ? null : f.id_receta ?? null } : {}),
      ...(confirmar_parecido ? { confirmar_parecido: true } : {})
    };
    const fallo = async (e: any, msg: string) => {
      this.guardando.set(false);
      // Casi igual a otro producto: se confirma que es otro o se usa el que existe (en la lista de parecidos)
      if (e?.error?.codigo === 'PARECIDO') {
        this.parecidos.set(e.error.parecidos || []);
        if (await this.dialogo.confirmar({
          titulo: `¿«${f.nombre_producto}» es otro producto?`, mensaje: 'Ya existe uno casi igual:',
          advertencias: (e.error.parecidos || []).map((p: ProductoParecido) => `${p.nombre_producto}${p.sucursales ? ' · ' + p.sucursales : ''}`),
          peligro: true, textoConfirmar: id ? 'Guardar de todos modos' : 'Crear de todos modos'
        })) this.guardarProducto(true);
        return;
      }
      this.errorModal.set(e?.error?.error || msg);
    };

    if (id) {
      // Editar: solo datos del producto, no el inventario
      this.productoService.actualizarProducto(id, datos, this.fotoNueva).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Producto actualizado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo actualizar el producto.')
      });
    } else {
      // Crear: queda asignado a la sucursal elegida con su stock inicial
      const nuevo = { ...datos, id_sucursal: this.idSucursal(),
                      stock_inicial: f.tipo_producto === 'PREPARADO' ? 0 : f.stock_inicial || 0 };
      this.productoService.crearProducto(nuevo, this.fotoNueva).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Producto creado'); this.cargarProductos(); },
        error: (e: any) => fallo(e, 'No se pudo crear el producto.')
      });
    }
  }

  async toggleEstadoProducto(prod: any) {
    // Mientras se vende (carritos, mesas, pedidos QR) no se desactiva: no se podría cobrar
    let encargos = 0;
    if (prod.estado_activo) {
      const uso = await firstValueFrom(this.productoService.usoProducto(prod.id_producto)).catch(() => null);
      if (uso?.en_venta) return this.dialogo.error(`No se puede desactivar «${prod.nombre_producto}»: se está vendiendo ${uso.en_venta}.`);
      encargos = uso?.encargos || 0;
    }
    if (!(await this.dialogo.confirmar(prod.estado_activo
      ? { titulo: `¿Desactivar «${prod.nombre_producto}»?`, textoConfirmar: 'Desactivar', peligro: true,
          mensaje: 'Dejará de venderse en Punto de venta y Mesas y no aparecerá en el menú QR. Su historial se conserva.',
          advertencias: encargos ? [`Está en ${encargos} ${encargos === 1 ? 'encargo por entregar' : 'encargos por entregar'}.`] : [] }
      : { titulo: `¿Reactivar «${prod.nombre_producto}»?`, textoConfirmar: 'Reactivar',
          mensaje: 'Volverá a venderse y a aparecer en el menú QR si tiene stock.' }))) return;
    const accion = prod.estado_activo
      ? this.productoService.desactivarProducto(prod.id_producto)
      : this.productoService.reactivarProducto(prod.id_producto);
    const texto  = prod.estado_activo ? 'desactivado' : 'reactivado';
    accion.subscribe({
      next:  () => { this.dialogo.avisar(`«${prod.nombre_producto}» ${texto}`); this.cargarProductos(); },
      error: (e: any) => this.dialogo.error(e?.error?.error || `No se pudo dejar el producto ${texto}.`)
    });
  }

  // ─── MOVIMIENTO (entrada o merma) ───
  abrirMovimiento(prod: any) {
    this.productoMov.set(prod);
    this.errorMov.set('');
    this.guardando.set(false);
    this.mov.set({ tipo: 'INGRESO', cantidad: null, motivo: '', detalle: '', vence: this.venceSugerido(prod), costo: null });
    this.reparto.set([]);
    if (this.puedeRepartir() && prod?.tipo_producto !== 'PREPARADO') this.prepararReparto(prod);
    // Lo comprado: el administrador ve el costo de la última compra ya escrito (los costos son solo suyos)
    if (this.esAdmin() && prod?.tipo_producto === 'COMPRADO')
      this.inventarioService.costoActual(prod.id_producto).subscribe({
        next: (r) => { if (this.productoMov() === prod) this.mov.update(m => ({ ...m, costo: r.costo })); }
      });
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

  /** Lo comprado trae la fecha del envase: se sugiere hoy + su vida útil (en días) */
  private venceSugerido(prod: any): string {
    if (prod?.tipo_producto !== 'COMPRADO') return '';
    const dias = prod.vida_util_horas ? Math.round(prod.vida_util_horas / 24) : this.vidaPorDefecto('COMPRADO');
    const d = new Date(`${this.hoy()}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return d.toLocaleDateString('en-CA');
  }

  get stockTrasMovimiento(): number {
    const mov = this.mov(), n = Math.trunc(Number(mov.cantidad)) || 0;
    return (Number(this.productoMov()?.stock_actual) || 0) + (mov.tipo === 'SALIDA' ? -n : n - this.totalRepartido);
  }

  puedeRepartir() { return this.esAdmin() || this.permisos.tienePermiso('reparto'); }

  /** El cajero solo carga su sucursal: para repartir se piden todas (una vez) */
  private destinosReparto: any[] | null = null;

  private prepararReparto(prod: any) {
    const llenar = (lista: any[]) => {
      if (this.productoMov() !== prod) return;
      this.reparto.set(lista.filter(s => s.estado_activo !== false && s.id_sucursal !== this.idSucursal())
        .map(s => ({ id_sucursal: s.id_sucursal, nombre_sucursal: s.nombre_sucursal, cantidad: null })));
    };
    if (this.esAdmin()) return llenar(this.sucursales());
    if (this.destinosReparto) return llenar(this.destinosReparto);
    this.http.get<any[]>(`${this.apiUrl}/sucursales`).subscribe({
      next: (l) => { this.destinosReparto = l || []; llenar(this.destinosReparto); }
    });
  }

  /** El reparto solo se ve en una entrada por producción */
  get repartiendo(): boolean {
    return this.mov().tipo === 'INGRESO' && this.mov().motivo === 'Producción' && this.reparto().length > 0;
  }

  get totalRepartido(): number {
    return this.repartiendo ? this.reparto().reduce((s, x) => s + (Math.trunc(Number(x.cantidad)) || 0), 0) : 0;
  }

  guardarMovimiento() {
    const cantidad = Number(this.mov().cantidad);
    const detalle  = this.mov().detalle.trim();
    if (!Number.isInteger(cantidad) || cantidad < 1) return this.errorMov.set('La cantidad debe ser un número entero mayor a 0.');
    if (this.stockTrasMovimiento < 0) return this.errorMov.set(`Solo hay ${this.productoMov().stock_actual || 0} en stock.`);
    if (this.mov().motivo === 'Otro' && !detalle) return this.errorMov.set('Describe el motivo en la observación.');
    if (this.reparto().some(x => x.cantidad != null && String(x.cantidad) !== '' && (!Number.isInteger(Number(x.cantidad)) || Number(x.cantidad) < 0)))
      return this.errorMov.set('Las cantidades a repartir deben ser números enteros.');
    if (this.totalRepartido > cantidad) return this.errorMov.set(`Se reparten ${this.totalRepartido} y solo se produjeron ${cantidad}.`);
    const reparto = this.repartiendo
      ? this.reparto().filter(x => Number(x.cantidad) > 0).map(x => ({ id_sucursal: x.id_sucursal, cantidad: Number(x.cantidad) }))
      : [];

    const prod = this.productoMov();
    this.guardando.set(true);
    this.inventarioService.registrar({
      id_producto: prod.id_producto, id_sucursal: this.idSucursal(),
      tipo: this.mov().tipo, cantidad, motivo: this.mov().motivo, detalle: detalle || undefined,
      fecha_vencimiento: this.mov().tipo === 'INGRESO' && this.mov().vence ? this.mov().vence : undefined,
      costo_unitario: this.mov().tipo === 'INGRESO' && this.mov().costo != null && String(this.mov().costo) !== ''
                      ? Number(this.mov().costo) : undefined,
      reparto: reparto.length ? reparto : undefined
    }).subscribe({
      next: (r) => {
        this.fijarStock(Number(prod.id_producto), r.stock_actual);
        this.cerrarMovimiento();
        this.dialogo.avisar(r.repartido
          ? `Producción registrada: ${r.repartido} repartidos, ${prod.nombre_producto} queda en ${r.stock_actual}`
          : `${this.mov().tipo === 'INGRESO' ? 'Entrada' : 'Merma'} registrada: ${prod.nombre_producto} queda en ${r.stock_actual}`);
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
