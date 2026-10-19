import { Component, computed, effect, inject, OnInit, OnDestroy, signal, untracked } from '@angular/core';
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
import { LucideAngularModule, UtensilsCrossed, ShoppingBag, ReceiptText, Search, X, Minus, Plus, Check,
         SearchX, WifiOff, PartyPopper, Pencil, BadgePercent } from 'lucide-angular';

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
  imports:     [CommonModule, FormsModule, ImagenUrlPipe, LucideAngularModule, ConfirmacionComponent],
  templateUrl: './menu-digital.component.html',
  styleUrls:   ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
                '../../shared/formulario/formulario.css', './menu-digital.component.css']
})
export class MenuDigitalComponent implements OnInit, OnDestroy {
  readonly Number = Number;
  readonly icons  = { menu: UtensilsCrossed, carrito: ShoppingBag, mesa: ReceiptText, buscar: Search, cerrar: X,
                      menos: Minus, mas: Plus, listo: Check, sinResultados: SearchX, sinConexion: WifiOff,
                      qrInvalido: SearchX, gracias: PartyPopper, editar: Pencil, promo: BadgePercent };

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

  // ─── Catálogo ───
  readonly catalogo        = signal<any[]>([]);
  readonly categorias      = signal<{ id: number; nombre: string }[]>([]);
  readonly categoriaActiva = signal<number | null>(null);
  readonly busqueda        = signal('');

  /** Los agotados van al final para que el cliente vea primero lo que puede pedir */
  readonly catalogoFiltrado = computed(() => {
    const texto = this.busqueda().trim().toLowerCase(), cat = this.categoriaActiva();
    return this.catalogo().filter(p =>
      (!cat || Number(p.id_categoria) === cat) &&
      (!texto || p.nombre_producto.toLowerCase().includes(texto))
    ).sort((a, b) => Number(a.stock_actual <= 0) - Number(b.stock_actual <= 0));
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

  constructor() {
    effect(() => {
      const clave = this.claveCarrito();
      untracked(() => this.cotizarCarrito(clave));
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

    // Respaldo del socket
    this.timers.push(sondeo(() => this.refrescarEstado(), 20_000));
    this.timers.push(sondeo(() => { this.cargarInfo(); this.cargarCatalogo(); }, 60_000));
  }

  ngOnDestroy() {
    this.socket?.disconnect();
    this.timers.forEach(detener => detener());
    clearTimeout(this.avisoTimer);
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
        const catalogo = items.map(p => ({ ...p, stock_actual: Number(p.stock_actual) || 0 }));
        const cats = new Map<number, string>();
        catalogo.forEach(p => cats.set(Number(p.id_categoria), p.nombre_categoria));
        this.catalogo.set(catalogo);
        this.categorias.set([...cats.entries()].map(([id, nombre]) => ({ id, nombre })));

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
      if (d.estado === 'Confirmado') this.notificar('✅ ¡Tu pedido fue confirmado! Ya lo estamos preparando.');
      if (d.estado === 'Entregado')  this.notificar('🍰 Tu pedido fue entregado. ¡Buen provecho!');
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
        this.mostrarAviso('📨 Pedido enviado. El cajero lo confirmará en breve.');
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
            && Number(res.cuenta.mi_pagado) > 0) this.notificar('✅ Tu parte ya está pagada. ¡Gracias!');

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
