import { Component, afterRenderEffect, computed, effect, inject, OnInit, OnDestroy, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../../environments/environment';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { AjustesService } from '../../../core/services/ajustes.service';
import { sondeo } from '../../../core/utils/sondeo';
import { ConfirmacionComponent } from '../../shared/confirmacion/confirmacion.component';
import type { MensajeChat } from '../../shared/asistente/asistente-chat.component';
import { componenteDiferido } from '../../../core/utils/diferido';
import { Cotizacion, etiquetaPromocion } from '../../../core/services/promocion.service';
import { LucideAngularModule, LucideIconData, UtensilsCrossed, ShoppingBag, ReceiptText, Search, X, Minus, Plus, Check,
         SearchX, WifiOff, PartyPopper, Pencil, BadgePercent, LayoutGrid, ChevronDown, Info, RotateCcw,
         Sparkles, ShoppingBasket, ChefHat } from 'lucide-angular';
import { CarruselRecomendadosComponent } from './carrusel-recomendados.component';
import { BienvenidaMenuComponent } from './bienvenida-menu.component';
import { PanelMenuComponent } from './panel-menu.component';
import { iconoCategoria, listaIngredientes, nombreBonito, pasosPreparacion } from './ficha';

type Vista = 'menu' | 'carrito' | 'pedidos';

interface InfoMesa {
  numero_mesa: number; nombre_sucursal: string; id_sucursal: number; recibe_pedidos: boolean; pedidos_desactivados?: boolean;
}

interface ItemCarrito {
  id_producto:     number;
  nombre_producto: string;
  precio_unitario: number;
  url_imagen:      string | null;
  cantidad:        number;
}

interface MiConsumo {
  total_mesa:   number;
  mi_pendiente: number;
  mi_pagado:    number;
  mi_descuento?: number;
  items: { nombre_producto: string; cantidad: number; subtotal: number; pagado: boolean }[];
}

const CLAVE_CELULAR = 'sgiv_cliente_mesa';
const CLAVE_NOMBRE  = 'sgiv_cliente_nombre';

// Los navegadores no dan la MAC ni el IMEI del celular: se genera un código
// aleatorio una sola vez y queda guardado en este navegador.
const codigoCelular = (): string => {
  try {
    const guardado = localStorage.getItem(CLAVE_CELULAR);
    if (guardado && /^[0-9a-f]{32}$/.test(guardado)) return guardado;
  } catch { }
  const bytes = crypto.getRandomValues(new Uint8Array(16));   // funciona también sin https
  const nuevo = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(CLAVE_CELULAR, nuevo); } catch { }
  return nuevo;
};

const leerNombre = (): string => {
  try { return localStorage.getItem(CLAVE_NOMBRE) || ''; } catch { return ''; }
};

// ─── Menú digital del cliente: /menu/<codigo QR> ───
@Component({
  selector:    'app-menu-digital',
  standalone:  true,
  imports:     [CommonModule, FormsModule, ImagenUrlPipe, LucideAngularModule, ConfirmacionComponent,
                CarruselRecomendadosComponent, BienvenidaMenuComponent, PanelMenuComponent],
  templateUrl: './menu-digital.component.html',
  styleUrls:   ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
                '../../shared/formulario/formulario.css', './menu-digital.component.css']
})
export class MenuDigitalComponent implements OnInit, OnDestroy {
  readonly Number = Number;
  readonly icons  = { menu: UtensilsCrossed, carrito: ShoppingBag, mesa: ReceiptText, buscar: Search, cerrar: X,
                      menos: Minus, mas: Plus, listo: Check, sinResultados: SearchX, sinConexion: WifiOff,
                      qrInvalido: SearchX, gracias: PartyPopper, editar: Pencil, promo: BadgePercent,
                      categorias: LayoutGrid, abrir: ChevronDown, info: Info, volver: RotateCcw,
                      filtroPromo: Sparkles, ingredientes: ShoppingBasket, preparacion: ChefHat };
  readonly nombreBonito = nombreBonito;

  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);
  readonly moneda = inject(AjustesService).moneda;
  readonly ajustes = inject(AjustesService);

  private readonly api       = `${environment.apiUrl}/menu/m`;
  private readonly socketUrl = environment.apiUrl.replace('/api', '');

  // ─── Cada celular: código propio y nombre opcional ───
  readonly celular = codigoCelular();
  readonly nombreCliente  = signal(leerNombre());
  readonly nombreEditado  = signal('');
  readonly editandoNombre = signal(false);
  readonly bienvenida     = signal(false);

  codigo = '';
  readonly estadoCarga = signal<'cargando' | 'invalido' | 'error' | 'listo'>('cargando');
  readonly info        = signal<InfoMesa | null>(null);
  readonly vista       = signal<Vista>('menu');

  // ─── Catálogo (llega ordenado por el orden de categorías del admin) ───
  readonly catalogo        = signal<any[]>([]);
  private readonly ordenCategorias = signal<{ id: number; nombre: string; icono: LucideIconData }[]>([]);
  readonly busqueda        = signal('');
  readonly buscando        = signal(false);
  readonly promoFiltro     = signal<string | null>(null);
  readonly panel           = signal<'categorias' | 'promos' | null>(null);
  readonly volteadas       = signal<ReadonlySet<number>>(new Set());
  readonly resaltado       = signal<number | null>(null);

  // ─── La cabecera muestra la categoría que se está viendo ───
  readonly seccionActual   = signal<number | null>(null);

  /** Solo lo que tiene stock; si vuelve a haber, reaparece solo (llega por socket) */
  readonly disponibles = computed(() => this.catalogo().filter(p => p.stock_actual > 0));

  readonly categorias = computed(() => {
    const conteo = new Map<number, number>();
    for (const p of this.disponibles()) conteo.set(Number(p.id_categoria), (conteo.get(Number(p.id_categoria)) || 0) + 1);
    return this.ordenCategorias().filter(c => conteo.has(c.id)).map(c => ({ ...c, cantidad: conteo.get(c.id)! }));
  });

  readonly catalogoFiltrado = computed(() => {
    const texto = this.busqueda().trim().toLowerCase(), promo = this.promoFiltro();
    return this.disponibles().filter(p =>
      (!promo || p.promocion?.nombre === promo) &&
      (!texto || p.nombre_producto.toLowerCase().includes(texto)));
  });

  readonly secciones = computed(() => {
    const productos = this.catalogoFiltrado();
    return this.categorias()
      .map(c => ({ ...c, productos: productos.filter(p => Number(p.id_categoria) === c.id) }))
      .filter(s => s.productos.length);
  });

  readonly categoriaVisible = computed(() =>
    this.categorias().find(c => c.id === this.seccionActual()) ?? null);

  readonly recomendados = computed(() => this.catalogo().filter(p => p.destacado && p.stock_actual > 0));
  readonly mostrarCarrusel = computed(() =>
    this.recomendados().length > 0 && !this.busqueda().trim() && !this.promoFiltro());

  readonly cantidades = computed(() =>
    Object.fromEntries(this.carrito().map(i => [i.id_producto, i.cantidad])) as Record<number, number>);

  /** Productos con cada promoción (para «Ver productos» en el panel de promociones) */
  readonly productosPorPromo = computed(() => {
    const conteo: Record<string, number> = {};
    for (const p of this.disponibles()) if (p.promocion) conteo[p.promocion.nombre] = (conteo[p.promocion.nombre] || 0) + 1;
    return conteo;
  });

  // ─── Carrito ───
  readonly carrito            = signal<ItemCarrito[]>([]);
  readonly observacionGeneral = signal('');
  readonly enviando           = signal(false);
  readonly errorEnvio         = signal('');

  readonly totalCarrito    = computed(() => this.carrito().reduce((s, i) => s + i.precio_unitario * i.cantidad, 0));

  // ─── Promociones: las de hoy y el total estimado del carrito (las calcula el backend) ───
  readonly promociones = signal<{ nombre: string; texto: string }[]>([]);
  private readonly cotizacionGuardada = signal<{ clave: string; datos: Cotizacion } | null>(null);
  private readonly claveCarrito = computed(() => JSON.stringify(this.carrito().map(i => [i.id_producto, i.cantidad])));
  readonly cotizacion = computed(() => {
    const c = this.cotizacionGuardada();
    return c && c.clave === this.claveCarrito() ? c.datos : null;
  });
  readonly totalEstimado = computed(() => this.cotizacion()?.total ?? this.totalCarrito());
  private esperaCotizacion: any;

  etiquetaPromo(prod: any): string | null {
    return prod.promocion ? etiquetaPromocion(prod.promocion, this.moneda()) : null;
  }
  readonly cantidadCarrito = computed(() => this.carrito().reduce((s, i) => s + i.cantidad, 0));

  // ─── Mis pedidos y mi consumo en la cuenta de la mesa ───
  readonly pedidos         = signal<any[]>([]);
  readonly cuenta          = signal<MiConsumo | null>(null);
  readonly cancelando      = signal<Record<number, boolean>>({});
  readonly pedidoACancelar = signal<any>(null);
  readonly gracias         = signal(false);

  readonly miConsumo      = computed(() => this.cuenta()?.items ?? []);
  readonly pedidosActivos = computed(() =>
    this.pedidos().filter(p => ['Pendiente_Cajero', 'Confirmado'].includes(p.estado_pedido)).length);

  readonly aviso = signal<string | null>(null);

  // ─── Asistente con IA (se descarga solo si está disponible) ───
  readonly chatAsistente = componenteDiferido(() => this.ajustes.config().ia_cliente_disponible,
    () => import('../../shared/asistente/asistente-chat.component').then(m => m.AsistenteChatComponent));
  readonly sugerenciasAsistente = ['¿Qué me recomiendas?', '¿Qué hay para compartir entre 4?', '¿Qué bebidas tienen?', '¿Cómo hago mi pedido?'];
  readonly preguntarAsistente = (mensajes: MensajeChat[]) =>
    this.http.post<{ respuesta: string }>(`${this.api}/${this.codigo}/asistente`, { mensajes, cliente_mesa: this.celular });

  private socket: Socket | null = null;
  private timers: (() => void)[] = [];
  private avisoTimer: any;
  private resaltadoTimer: any;
  // Posición de cada título de categoría: se mide al cambiar la página, no en cada paso del scroll
  private posiciones: { id: number; top: number }[] = [];
  private linea = 0;
  private tamano: ResizeObserver | null = null;
  private readonly alDesplazar = () => {
    const y = scrollY + this.linea;
    let actual: number | null = null;
    for (const s of this.posiciones) { if (s.top > y) break; actual = s.id; }
    this.seccionActual.set(actual);
  };

  constructor() {
    effect(() => {
      const clave = this.claveCarrito();
      untracked(() => this.cotizarCarrito(clave));
    });
    afterRenderEffect(() => {
      this.secciones(); this.vista(); this.estadoCarga();
      untracked(() => this.medirSecciones());
    });
  }

  private cotizarCarrito(clave: string) {
    clearTimeout(this.esperaCotizacion);
    const items = this.carrito().map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad }));
    if (!items.length || !this.codigo) return;
    this.esperaCotizacion = setTimeout(() =>
      this.http.post<Cotizacion>(`${this.api}/${this.codigo}/cotizar`, { items }).subscribe({
        next: (datos) => this.cotizacionGuardada.set({ clave, datos })
      }), 250);
  }

  // ─── Ciclo de vida ───
  ngOnInit() {
    this.codigo = this.route.snapshot.paramMap.get('codigo') || '';
    if (!/^[0-9a-f]{32}$/i.test(this.codigo)) {
      this.estadoCarga.set('invalido');
      return;
    }
    this.cargarTodo();
    this.conectarSocket();
    addEventListener('scroll', this.alDesplazar, { passive: true });
    // Fotos que cargan, tarjetas que giran o avisos que aparecen cambian el alto: se vuelve a medir
    this.tamano = new ResizeObserver(() => this.medirSecciones());
    this.tamano.observe(document.body);

    // Respaldo del socket
    this.timers.push(sondeo(() => this.refrescarEstado(), 20_000));
    this.timers.push(sondeo(() => { this.cargarInfo(); this.cargarCatalogo(); }, 60_000));
  }

  ngOnDestroy() {
    this.socket?.disconnect();
    this.timers.forEach(detener => detener());
    removeEventListener('scroll', this.alDesplazar);
    this.tamano?.disconnect();
    clearTimeout(this.avisoTimer);
    clearTimeout(this.resaltadoTimer);
    clearTimeout(this.esperaCotizacion);
  }

  // ─── Carga ───
  cargarTodo() {
    this.estadoCarga.set('cargando');
    this.http.get<InfoMesa>(`${this.api}/${this.codigo}`).subscribe({
      next: (info) => {
        this.info.set(info);
        this.cargarCatalogo(() => {
          this.estadoCarga.set('listo');
          this.bienvenida.set(!this.yaSeDioBienvenida());
          this.nombreEditado.set(this.nombreCliente());
        });
        this.refrescarEstado();
      },
      error: (e) => this.estadoCarga.set(e.status === 404 ? 'invalido' : 'error')
    });
  }

  private cargarInfo() {
    this.http.get<InfoMesa>(`${this.api}/${this.codigo}`).subscribe({
      next: (info) => this.info.set(info)
    });
  }

  cargarCatalogo(alTerminar?: () => void) {
    this.http.get<{ nombre: string; texto: string }[]>(`${this.api}/${this.codigo}/promociones`).subscribe({
      next: (p) => this.promociones.set(p)
    });
    this.http.get<any[]>(`${this.api}/${this.codigo}/catalogo`).subscribe({
      next: (items) => {
        const catalogo = items.map(p => {
          const ingredientes = listaIngredientes(p.ingredientes), pasos = pasosPreparacion(p.preparacion);
          return { ...p, stock_actual: Number(p.stock_actual) || 0, nombre: nombreBonito(p.nombre_producto),
                   ingredientes_lista: ingredientes, pasos, tiene_ficha: ingredientes.length > 0 || pasos.length > 0 };
        });
        const cats = new Map<number, { id: number; nombre: string; icono: LucideIconData }>();
        for (const p of catalogo) {
          const id = Number(p.id_categoria);
          if (!cats.has(id)) cats.set(id, { id, nombre: nombreBonito(p.nombre_categoria), icono: iconoCategoria(p.nombre_categoria) });
        }
        this.catalogo.set(catalogo);
        this.ordenCategorias.set([...cats.values()]);
        if (this.promoFiltro() && !catalogo.some(p => p.promocion?.nombre === this.promoFiltro())) this.promoFiltro.set(null);

        // Precios al día; lo que ya no está en el menú sale del carrito
        const retirados: string[] = [];
        this.carrito.update(carrito => carrito.flatMap(item => {
          const p = catalogo.find(c => c.id_producto === item.id_producto);
          if (!p) { retirados.push(item.nombre_producto); return []; }
          return [{ ...item, precio_unitario: Number(p.precio_unitario) }];
        }));
        if (retirados.length) this.mostrarAviso(`Ya no está disponible: ${retirados.join(', ')}`);
        this.ajustarCarritoAlStock();
        this.cotizacionGuardada.set(null);
        this.cotizarCarrito(this.claveCarrito());

        alTerminar?.();
      },
      error: () => {
        if (alTerminar) this.estadoCarga.set('error');
      }
    });
  }

  // ─── Tiempo real ───
  private conectarSocket() {
    this.socket = io(this.socketUrl, { transports: ['websocket'] });
    this.socket.on('connect', () => {
      this.socket?.emit('unirse_mesa', this.codigo);
      this.refrescarEstado();
    });

    this.socket.on('actualizacion_stock_global', (d: any) => {
      if (!this.info() || Number(d?.id_sucursal) !== Number(this.info()!.id_sucursal)) return;
      if (this.fijarStock(Number(d.id_producto), Math.max(0, Number(d.nueva_cantidad_disponible) || 0)))
        this.ajustarCarritoAlStock();
    });

    this.socket.on('catalogo:actualizado', () => this.cargarCatalogo());

    this.socket.on('pedido:estado', (d: any) => {
      if (!this.pedidos().some(p => p.id_pedido === Number(d?.id_pedido))) return;
      if (d.estado === 'Confirmado') this.notificar('¡Tu pedido fue confirmado! Ya lo estamos preparando.');
      if (d.estado === 'Entregado')  this.notificar('Tu pedido fue entregado. ¡Buen provecho!');
      if (d.estado === 'Cancelado')  this.notificar('Tu pedido no pudo ser atendido. Consulta en caja.');
      this.refrescarEstado();
    });

    this.socket.on('cuenta:actualizada', () => this.refrescarEstado());
    this.socket.on('cuenta:cerrada',     () => this.refrescarEstado(true));
  }

  /** Cambia el stock de un producto del catálogo; false si no está en él */
  private fijarStock(id_producto: number, stock: number): boolean {
    if (!this.catalogo().some(p => p.id_producto === id_producto)) return false;
    this.catalogo.update(c => c.map(p => p.id_producto === id_producto ? { ...p, stock_actual: stock } : p));
    return true;
  }

  // ─── Disponibilidad ───
  enCarrito(id_producto: number): number {
    return this.carrito().find(i => i.id_producto === id_producto)?.cantidad || 0;
  }

  /** Stock real menos lo que ya está en el carrito */
  disponible(prod: any): number {
    return Math.max(0, Number(prod.stock_actual) - this.enCarrito(prod.id_producto));
  }

  private ajustarCarritoAlStock() {
    const ajustes: string[] = [];
    const catalogo = this.catalogo();
    const carrito = this.carrito().flatMap(item => {
      const stock = Number(catalogo.find(p => p.id_producto === item.id_producto)?.stock_actual) || 0;
      if (item.cantidad <= stock) return [item];
      if (stock === 0) { ajustes.push(`${item.nombre_producto} se agotó`); return []; }
      ajustes.push(`${item.nombre_producto}: solo quedan ${stock}`);
      return [{ ...item, cantidad: stock }];
    });
    if (!ajustes.length) return;
    this.carrito.set(carrito);
    this.mostrarAviso(`Actualizamos tu carrito — ${ajustes.join('; ')}`);
  }

  // ─── Carrito ───
  agregar(prod: any) {
    if (this.disponible(prod) <= 0) return;
    this.carrito.update(c => c.some(i => i.id_producto === prod.id_producto)
      ? c.map(i => i.id_producto === prod.id_producto ? { ...i, cantidad: i.cantidad + 1 } : i)
      : [...c, {
          id_producto:     prod.id_producto,
          nombre_producto: prod.nombre_producto,
          precio_unitario: Number(prod.precio_unitario),
          url_imagen:      prod.url_imagen,
          cantidad:        1
        }]);
  }

  quitarUno(id_producto: number) {
    this.carrito.update(c => c.flatMap(i =>
      i.id_producto !== id_producto ? [i] : i.cantidad > 1 ? [{ ...i, cantidad: i.cantidad - 1 }] : []));
  }

  agregarUno(item: ItemCarrito) {
    const prod = this.catalogo().find(p => p.id_producto === item.id_producto);
    if (prod) this.agregar(prod);
  }

  puedeSumar(item: ItemCarrito): boolean {
    const prod = this.catalogo().find(p => p.id_producto === item.id_producto);
    return !!prod && this.disponible(prod) > 0;
  }

  eliminar(item: ItemCarrito) {
    this.carrito.update(c => c.filter(i => i.id_producto !== item.id_producto));
  }

  // ─── Enviar pedido ───
  enviarPedido() {
    const carrito = this.carrito();
    if (!carrito.length || this.enviando()) return;
    if (!this.info()?.recibe_pedidos)
      return this.errorEnvio.set('En este momento no estamos recibiendo pedidos desde el menú. Consulta en caja.');
    this.enviando.set(true);
    this.errorEnvio.set('');

    const body = {
      cliente_mesa:        this.celular,
      nombre_cliente:      this.nombreCliente().trim() || null,
      observacion_general: this.observacionGeneral().trim() || null,
      items: carrito.map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad }))
    };

    this.http.post<any>(`${this.api}/${this.codigo}/pedidos`, body).subscribe({
      next: () => {
        this.carrito.set([]);
        this.observacionGeneral.set('');
        this.enviando.set(false);
        this.gracias.set(false);
        this.vista.set('pedidos');
        this.mostrarAviso('Pedido enviado. El cajero lo confirmará en breve.');
        this.refrescarEstado();
      },
      error: (e) => {
        this.enviando.set(false);
        const err = e?.error || {};
        this.errorEnvio.set(err.error || 'No se pudo enviar el pedido. Revisa tu conexión e intenta de nuevo.');
        if (err.codigo === 'STOCK_INSUFICIENTE' && err.id_producto) {
          this.fijarStock(err.id_producto, Number(err.disponible) || 0);
          this.ajustarCarritoAlStock();
        }
        if (err.codigo === 'PRODUCTO_NO_DISPONIBLE') this.cargarCatalogo();
        if (err.codigo === 'NO_RECIBE_PEDIDOS') this.info.update(i => i && { ...i, recibe_pedidos: false });
      }
    });
  }

  // ─── Navegación del menú ───
  /** Alto de la cabecera que queda fija al bajar (el logo y el nombre se van con la página) */
  private altoFijo(): number {
    const cabecera = document.querySelector('.cabecera') as HTMLElement | null;
    return cabecera ? cabecera.offsetHeight + (parseFloat(getComputedStyle(cabecera).top) || 0) : 0;
  }

  private medirSecciones() {
    const enMenu = this.vista() === 'menu' && this.estadoCarga() === 'listo';
    this.linea = this.altoFijo() + 24;
    this.posiciones = !enMenu ? [] : Array.from(document.querySelectorAll<HTMLElement>('[data-seccion]'), el =>
      ({ id: Number(el.dataset['seccion']), top: el.getBoundingClientRect().top + scrollY }));
    this.alDesplazar();
  }

  /** Baja hasta el elemento dejando lugar a la cabecera fija */
  private bajarA(id: string) {
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const destino = el.getBoundingClientRect().top + scrollY - this.altoFijo() - 12;
      scrollTo({ top: Math.max(0, destino), behavior: 'smooth' });
    });
  }

  irACategoria(id: number) {
    this.panel.set(null);
    this.busqueda.set('');
    this.buscando.set(false);
    this.promoFiltro.set(null);
    this.bajarA(`cat-${id}`);
  }

  elegirPromo(nombre: string) {
    this.panel.set(null);
    this.busqueda.set('');
    this.buscando.set(false);
    this.promoFiltro.set(nombre);
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  abrirBusqueda() {
    this.buscando.set(true);
    this.promoFiltro.set(null);
    requestAnimationFrame(() => document.getElementById('buscar-producto')?.focus());
  }

  cerrarBusqueda() {
    this.busqueda.set('');
    this.buscando.set(false);
  }

  voltear(prod: any) {
    if (!prod.tiene_ficha) return;
    this.volteadas.update(v => {
      const nuevo = new Set(v);
      nuevo.has(prod.id_producto) ? nuevo.delete(prod.id_producto) : nuevo.add(prod.id_producto);
      return nuevo;
    });
  }

  /** Desde el carrusel: baja hasta la tarjeta del producto y la resalta */
  verProducto(prod: any) {
    this.busqueda.set('');
    this.buscando.set(false);
    this.promoFiltro.set(null);
    this.resaltado.set(prod.id_producto);
    this.bajarA(`prod-${prod.id_producto}`);
    clearTimeout(this.resaltadoTimer);
    this.resaltadoTimer = setTimeout(() => this.resaltado.set(null), 1800);
  }

  // ─── Bienvenida y nombre del cliente ───
  private yaSeDioBienvenida(): boolean {
    try { return sessionStorage.getItem(`sgiv_bienvenida_${this.codigo}`) === '1'; } catch { return false; }
  }

  entrar() {
    this.guardarNombre();
    this.bienvenida.set(false);
    try { sessionStorage.setItem(`sgiv_bienvenida_${this.codigo}`, '1'); } catch { }
  }

  editarNombre() {
    this.nombreEditado.set(this.nombreCliente());
    this.editandoNombre.set(true);
  }

  guardarNombre() {
    const nombre = this.nombreEditado().replace(/\s+/g, ' ').trim().slice(0, 40);
    this.nombreCliente.set(nombre);
    this.nombreEditado.set(nombre);
    this.editandoNombre.set(false);
    try { localStorage.setItem(CLAVE_NOMBRE, nombre); } catch { }
  }

  // ─── Mis pedidos y mi consumo (por el código de este celular) ───
  refrescarEstado(cuentaCerrada = false) {
    this.http.get<{ pedidos: any[]; cuenta: MiConsumo | null }>(`${this.api}/${this.codigo}/estado`,
                                                                 { params: { cliente: this.celular } }).subscribe({
      next: (res) => {
        const antes = this.cuenta();
        const yaConsumia = !!antes?.items.length;
        if (cuentaCerrada && yaConsumia && !res.cuenta) this.gracias.set(true);
        // Pagó su parte y la mesa sigue abierta
        if (Number(antes?.mi_pendiente) > 0 && res.cuenta && Number(res.cuenta.mi_pendiente) === 0
            && Number(res.cuenta.mi_pagado) > 0) this.notificar('Tu parte ya está pagada. ¡Gracias!');

        this.cuenta.set(res.cuenta);
        this.pedidos.set(res.pedidos || []);
      }
    });
  }

  cancelar(pedido: any) {
    const id = pedido.id_pedido;
    const listo = (mensaje: string) => {
      this.cancelando.update(c => { const { [id]: _, ...resto } = c; return resto; });
      this.mostrarAviso(mensaje);
      this.refrescarEstado();
    };
    this.pedidoACancelar.set(null);
    this.cancelando.update(c => ({ ...c, [id]: true }));
    this.http.post<any>(`${this.api}/${this.codigo}/pedidos/${id}/cancelar`, { cliente_mesa: this.celular }).subscribe({
      next: () => listo('Pedido cancelado'),
      error: (e) => listo(e?.error?.error || 'No se pudo cancelar el pedido')
    });
  }

  // ─── Presentación de estados ───
  readonly pasos = [
    { estado: 'Pendiente_Cajero', texto: 'Enviado' },
    { estado: 'Confirmado',       texto: 'Confirmado' },
    { estado: 'Entregado',        texto: 'Entregado' }
  ];

  pasoAlcanzado(pedido: any, paso: string): boolean {
    const orden = this.pasos.map(p => p.estado);
    return orden.indexOf(pedido.estado_pedido) >= orden.indexOf(paso);
  }

  infoEstado(estado: string): { texto: string; detalle: string; clase: string } {
    const mapa: Record<string, { texto: string; detalle: string; clase: string }> = {
      Pendiente_Cajero: { texto: 'Esperando confirmación', detalle: 'El cajero revisará tu pedido en un momento.', clase: 'aviso' },
      Confirmado:       { texto: 'Confirmado',             detalle: 'Estamos preparando tu pedido.',              clase: 'ok' },
      Entregado:        { texto: 'Entregado',              detalle: '¡Buen provecho!',                             clase: 'ok' },
      Cancelado:        { texto: 'No atendido',            detalle: 'Tu pedido no pudo ser atendido. Consulta en caja.', clase: 'mal' }
    };
    return mapa[estado] ?? { texto: estado, detalle: '', clase: 'neutro' };
  }

  // ─── Avisos ───
  private notificar(msg: string) {
    if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
    this.mostrarAviso(msg);
  }

  private mostrarAviso(msg: string) {
    this.aviso.set(msg);
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => this.aviso.set(null), 4500);
  }
}
