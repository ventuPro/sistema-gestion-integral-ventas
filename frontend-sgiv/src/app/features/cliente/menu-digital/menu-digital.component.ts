import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../../environments/environment';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';

type Vista = 'menu' | 'carrito' | 'pedidos';

interface ItemCarrito {
  id_producto:     number;
  nombre_producto: string;
  precio_unitario: number;
  url_imagen:      string | null;
  cantidad:        number;
}

interface PedidoGuardado { id: number; t: number; }

// ─── Menú digital del cliente: /menu/<codigo QR> ───
@Component({
  selector:    'app-menu-digital',
  standalone:  true,
  imports:     [CommonModule, FormsModule, ImagenUrlPipe],
  templateUrl: './menu-digital.component.html',
  styleUrl:    './menu-digital.component.css'
})
export class MenuDigitalComponent implements OnInit, OnDestroy {
  readonly Number = Number;

  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);
  private cdr   = inject(ChangeDetectorRef);

  private readonly api       = `${environment.apiUrl}/menu/m`;
  private readonly socketUrl = environment.apiUrl.replace('/api', '');
  private readonly VIGENCIA_PEDIDOS_MS = 6 * 60 * 60 * 1000;   // se olvidan tras 6 h

  codigo = '';
  estadoCarga: 'cargando' | 'invalido' | 'error' | 'listo' = 'cargando';
  info: { numero_mesa: number; nombre_sucursal: string; id_sucursal: number; recibe_pedidos: boolean } | null = null;
  vista: Vista = 'menu';

  // ─── Catálogo ───
  catalogo:   any[] = [];
  categorias: { id: number; nombre: string }[] = [];
  categoriaActiva: number | null = null;
  busqueda = '';

  // ─── Carrito ───
  carrito: ItemCarrito[] = [];
  observacionGeneral = '';
  enviando   = false;
  errorEnvio = '';

  // ─── Mis pedidos y cuenta de la mesa ───
  pedidos: any[] = [];
  cuenta: { total_acumulado: number; items: any[] } | null = null;
  cancelando: Record<number, boolean> = {};
  gracias = false;

  aviso: string | null = null;

  private socket: Socket | null = null;
  private timers: any[] = [];
  private avisoTimer: any;

  // ─── Ciclo de vida ───
  ngOnInit() {
    this.codigo = this.route.snapshot.paramMap.get('codigo') || '';
    if (!/^[0-9a-f]{32}$/i.test(this.codigo)) {
      this.estadoCarga = 'invalido';
      return;
    }
    this.cargarTodo();
    this.conectarSocket();

    // Respaldo del socket
    this.timers.push(setInterval(() => this.refrescarEstado(), 20_000));
    this.timers.push(setInterval(() => { this.cargarInfo(); this.cargarCatalogo(); }, 60_000));
  }

  ngOnDestroy() {
    this.socket?.disconnect();
    this.timers.forEach(t => clearInterval(t));
    clearTimeout(this.avisoTimer);
  }

  // ─── Carga ───
  cargarTodo() {
    this.estadoCarga = 'cargando';
    this.http.get<any>(`${this.api}/${this.codigo}`).subscribe({
      next: (info) => {
        this.info = info;
        this.cargarCatalogo(() => { this.estadoCarga = 'listo'; this.cdr.detectChanges(); });
        this.refrescarEstado();
      },
      error: (e) => {
        this.estadoCarga = e.status === 404 ? 'invalido' : 'error';
        this.cdr.detectChanges();
      }
    });
  }

  private cargarInfo() {
    this.http.get<any>(`${this.api}/${this.codigo}`).subscribe({
      next: (info) => { this.info = info; this.cdr.detectChanges(); }
    });
  }

  cargarCatalogo(alTerminar?: () => void) {
    this.http.get<any[]>(`${this.api}/${this.codigo}/catalogo`).subscribe({
      next: (items) => {
        this.catalogo = items.map(p => ({ ...p, stock_actual: Number(p.stock_actual) || 0 }));
        const cats = new Map<number, string>();
        this.catalogo.forEach(p => cats.set(Number(p.id_categoria), p.nombre_categoria));
        this.categorias = [...cats.entries()].map(([id, nombre]) => ({ id, nombre }));

        const retirados: string[] = [];
        this.carrito = this.carrito.filter(item => {
          const p = this.catalogo.find(c => c.id_producto === item.id_producto);
          if (!p) { retirados.push(item.nombre_producto); return false; }
          item.precio_unitario = Number(p.precio_unitario);
          return true;
        });
        if (retirados.length) this.mostrarAviso(`Ya no está disponible: ${retirados.join(', ')}`);
        this.ajustarCarritoAlStock();

        alTerminar?.();
        this.cdr.detectChanges();
      },
      error: () => {
        if (alTerminar) { this.estadoCarga = 'error'; this.cdr.detectChanges(); }
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
      if (!this.info || Number(d?.id_sucursal) !== Number(this.info.id_sucursal)) return;
      const prod = this.catalogo.find(p => p.id_producto === Number(d.id_producto));
      if (!prod) return;
      prod.stock_actual = Math.max(0, Number(d.nueva_cantidad_disponible) || 0);
      this.ajustarCarritoAlStock();
      this.cdr.detectChanges();
    });

    this.socket.on('catalogo:actualizado', () => this.cargarCatalogo());

    this.socket.on('pedido:estado', (d: any) => {
      if (!this.idsGuardados().includes(Number(d?.id_pedido))) return;
      if (d.estado === 'Confirmado') this.notificar('✅ ¡Tu pedido fue confirmado! Ya lo estamos preparando.');
      if (d.estado === 'Entregado')  this.notificar('🍰 Tu pedido fue entregado. ¡Buen provecho!');
      if (d.estado === 'Cancelado')  this.notificar('Tu pedido no pudo ser atendido. Consulta en caja.');
      this.refrescarEstado();
    });

    this.socket.on('cuenta:actualizada', () => this.refrescarEstado());
    this.socket.on('cuenta:cerrada',     () => this.refrescarEstado(true));
  }

  // ─── Disponibilidad ───
  enCarrito(id_producto: number): number {
    return this.carrito.find(i => i.id_producto === id_producto)?.cantidad || 0;
  }

  /** Stock real menos lo que ya está en el carrito */
  disponible(prod: any): number {
    return Math.max(0, Number(prod.stock_actual) - this.enCarrito(prod.id_producto));
  }

  private ajustarCarritoAlStock() {
    const ajustes: string[] = [];
    for (const item of [...this.carrito]) {
      const prod  = this.catalogo.find(p => p.id_producto === item.id_producto);
      const stock = Number(prod?.stock_actual) || 0;
      if (item.cantidad <= stock) continue;
      if (stock === 0) {
        this.carrito = this.carrito.filter(i => i !== item);
        ajustes.push(`${item.nombre_producto} se agotó`);
      } else {
        item.cantidad = stock;
        ajustes.push(`${item.nombre_producto}: solo quedan ${stock}`);
      }
    }
    if (ajustes.length) this.mostrarAviso(`Actualizamos tu carrito — ${ajustes.join('; ')}`);
  }

  // ─── Catálogo filtrado ───
  get catalogoFiltrado(): any[] {
    const texto = this.busqueda.trim().toLowerCase();
    return this.catalogo.filter(p =>
      (!this.categoriaActiva || Number(p.id_categoria) === this.categoriaActiva) &&
      (!texto || p.nombre_producto.toLowerCase().includes(texto))
    );
  }

  // ─── Carrito ───
  agregar(prod: any) {
    if (this.disponible(prod) <= 0) return;
    const item = this.carrito.find(i => i.id_producto === prod.id_producto);
    if (item) item.cantidad++;
    else this.carrito.push({
      id_producto:     prod.id_producto,
      nombre_producto: prod.nombre_producto,
      precio_unitario: Number(prod.precio_unitario),
      url_imagen:      prod.url_imagen,
      cantidad:        1
    });
    this.cdr.detectChanges();
  }

  quitarUno(id_producto: number) {
    const item = this.carrito.find(i => i.id_producto === id_producto);
    if (!item) return;
    if (item.cantidad > 1) item.cantidad--;
    else this.carrito = this.carrito.filter(i => i !== item);
    this.cdr.detectChanges();
  }

  agregarUno(item: ItemCarrito) {
    const prod = this.catalogo.find(p => p.id_producto === item.id_producto);
    if (prod) this.agregar(prod);
  }

  puedeSumar(item: ItemCarrito): boolean {
    const prod = this.catalogo.find(p => p.id_producto === item.id_producto);
    return !!prod && this.disponible(prod) > 0;
  }

  eliminar(item: ItemCarrito) {
    this.carrito = this.carrito.filter(i => i !== item);
    this.cdr.detectChanges();
  }

  get totalCarrito(): number {
    return this.carrito.reduce((s, i) => s + i.precio_unitario * i.cantidad, 0);
  }

  get cantidadCarrito(): number {
    return this.carrito.reduce((s, i) => s + i.cantidad, 0);
  }

  // ─── Enviar pedido ───
  enviarPedido() {
    if (!this.carrito.length || this.enviando) return;
    if (!this.info?.recibe_pedidos) {
      this.errorEnvio = 'En este momento no estamos recibiendo pedidos desde el menú. Consulta en caja.';
      return;
    }
    this.enviando   = true;
    this.errorEnvio = '';

    const body = {
      observacion_general: this.observacionGeneral.trim() || null,
      items: this.carrito.map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad }))
    };

    this.http.post<any>(`${this.api}/${this.codigo}/pedidos`, body).subscribe({
      next: (res) => {
        this.guardarId(res.id_pedido);
        this.carrito            = [];
        this.observacionGeneral = '';
        this.enviando           = false;
        this.gracias            = false;
        this.vista              = 'pedidos';
        this.mostrarAviso('📨 Pedido enviado. El cajero lo confirmará en breve.');
        this.refrescarEstado();
      },
      error: (e) => {
        this.enviando = false;
        const err = e?.error || {};
        this.errorEnvio = err.error || 'No se pudo enviar el pedido. Revisa tu conexión e intenta de nuevo.';
        if (err.codigo === 'STOCK_INSUFICIENTE' && err.id_producto) {
          const prod = this.catalogo.find(p => p.id_producto === err.id_producto);
          if (prod) prod.stock_actual = Number(err.disponible) || 0;
          this.ajustarCarritoAlStock();
        }
        if (err.codigo === 'PRODUCTO_NO_DISPONIBLE') this.cargarCatalogo();
        if (err.codigo === 'NO_RECIBE_PEDIDOS' && this.info) this.info.recibe_pedidos = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Mis pedidos ───
  private claveStorage(): string { return `sgiv_menu_${this.codigo}`; }

  private leerGuardados(): PedidoGuardado[] {
    try {
      const lista = JSON.parse(localStorage.getItem(this.claveStorage()) || '[]');
      return Array.isArray(lista) ? lista.filter(p => Date.now() - p.t < this.VIGENCIA_PEDIDOS_MS) : [];
    } catch { return []; }
  }

  private escribirGuardados(lista: PedidoGuardado[]) {
    try { localStorage.setItem(this.claveStorage(), JSON.stringify(lista)); } catch { }
  }

  private idsGuardados(): number[] { return this.leerGuardados().map(p => p.id); }

  private guardarId(id: number) {
    this.escribirGuardados([...this.leerGuardados(), { id, t: Date.now() }]);
  }

  refrescarEstado(cuentaCerrada = false) {
    const ids = this.idsGuardados();
    this.http.get<any>(`${this.api}/${this.codigo}/estado`, { params: { ids: ids.join(',') } }).subscribe({
      next: (res) => {
        const pedidos = (res.pedidos || []) as any[];
        this.cuenta   = res.cuenta;

        // Solo se olvidan ids de esta consulta (no perder un pedido recién enviado)
        const pagados = pedidos.filter(p => p.estado_pedido === 'Pagado');
        if (pagados.length && cuentaCerrada) this.gracias = true;
        const vigentes = new Set(pedidos.filter(p => p.estado_pedido !== 'Pagado').map(p => p.id_pedido));
        this.escribirGuardados(this.leerGuardados().filter(g => !ids.includes(g.id) || vigentes.has(g.id)));

        this.pedidos = pedidos
          .filter(p => p.estado_pedido !== 'Pagado')
          .sort((a, b) => b.id_pedido - a.id_pedido);
        this.cdr.detectChanges();
      }
    });
  }

  cancelar(pedido: any) {
    if (!confirm('¿Cancelar este pedido? Aún no fue confirmado por el cajero.')) return;
    this.cancelando[pedido.id_pedido] = true;
    this.http.post<any>(`${this.api}/${this.codigo}/pedidos/${pedido.id_pedido}/cancelar`, {}).subscribe({
      next: () => {
        delete this.cancelando[pedido.id_pedido];
        this.mostrarAviso('Pedido cancelado');
        this.refrescarEstado();
      },
      error: (e) => {
        delete this.cancelando[pedido.id_pedido];
        this.mostrarAviso(e?.error?.error || 'No se pudo cancelar el pedido');
        this.refrescarEstado();
      }
    });
  }

  get pedidosActivos(): number {
    return this.pedidos.filter(p => ['Pendiente_Cajero', 'Confirmado'].includes(p.estado_pedido)).length;
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
      Pendiente_Cajero: { texto: 'Esperando confirmación', detalle: 'El cajero revisará tu pedido en un momento.', clase: 'bg-amber-100 text-amber-800' },
      Confirmado:       { texto: 'Confirmado',             detalle: 'Estamos preparando tu pedido.',              clase: 'bg-blue-100 text-blue-800' },
      Entregado:        { texto: 'Entregado',              detalle: '¡Buen provecho!',                             clase: 'bg-green-100 text-green-800' },
      Cancelado:        { texto: 'No atendido',            detalle: 'Tu pedido no pudo ser atendido. Consulta en caja.', clase: 'bg-red-100 text-red-700' }
    };
    return mapa[estado] ?? { texto: estado, detalle: '', clase: 'bg-gray-100 text-gray-700' };
  }

  // ─── Avisos ───
  private notificar(msg: string) {
    if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
    this.mostrarAviso(msg);
  }

  private mostrarAviso(msg: string) {
    this.aviso = msg;
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => { this.aviso = null; this.cdr.detectChanges(); }, 4500);
    this.cdr.detectChanges();
  }
}
