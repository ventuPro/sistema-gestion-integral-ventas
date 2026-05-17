import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../../environments/environment';

type Vista = 'catalogo' | 'carrito' | 'tracking';

@Component({
  selector:    'app-menu-digital',
  standalone:  true,
  imports:     [CommonModule, FormsModule],
  templateUrl: './menu-digital.component.html',
  styleUrl:    './menu-digital.component.css'
})
export class MenuDigitalComponent implements OnInit, OnDestroy {
  readonly Number = Number;

  private route  = inject(ActivatedRoute);
  private http   = inject(HttpClient);
  private cdr    = inject(ChangeDetectorRef);

  private apiUrl    = environment.apiUrl;
  private socketUrl = environment.apiUrl.replace('/api', '');

  // ─── Datos de la mesa ───
  id_mesa    = 0;
  id_sucursal = 1;  // se obtiene de la mesa
  infoMesa:  any   = null;
  cargando   = true;

  // ─── Catálogo ───
  catalogo:   any[] = [];
  categorias: any[] = [];
  categoriaActiva: number | null = null;
  busqueda    = '';

  // ─── Carrito ───
  carrito:    any[] = [];
  observacionGeneral = '';
  enviando   = false;
  errorEnvio = '';

  // ─── Pedido / tracking ───
  pedidoActual: any  = null;
  vistaActual: Vista = 'catalogo';

  // ─── Socket ───
  private socket: Socket | null = null;
  private pollInterval: any;

ngOnInit() {
  this.id_mesa = +this.route.snapshot.paramMap.get('id_mesa')!;
  if (!this.id_mesa || isNaN(this.id_mesa)) {
    this.cargando = false;
    this.cdr.detectChanges();
    return;
  }
  this.cargarDatos();
  this.conectarSocket();
}

cargarDatos() {
  this.cargando = true;

  // PASO 1: obtener info de la mesa (incluye id_sucursal)
  this.http.get<any>(`${this.apiUrl}/menu/mesa/${this.id_mesa}`).subscribe({
    next: (mesa) => {
      this.infoMesa    = mesa;
      this.id_sucursal = Number(mesa.id_sucursal) || 1;

      // PASO 2: cargar catálogo de ESA sucursal
      this.http.get<any[]>(`${this.apiUrl}/menu/catalogo?id_sucursal=${this.id_sucursal}`).subscribe({
        next: (items) => {
          this.catalogo = items;

          const cats = new Map<number, string>();
          items.forEach(i => cats.set(Number(i.id_categoria), i.nombre_categoria));
          this.categorias = Array.from(cats.entries()).map(([id, nombre]) => ({ id, nombre }));

          this.cargando = false;
          this.cdr.detectChanges();
        },
        error: (e) => {
          console.error('Error cargando catálogo:', e);
          this.cargando = false;
          this.cdr.detectChanges();
        }
      });
    },
    error: (e) => {
      console.error('Error cargando mesa:', e);
      this.cargando = false;
      this.cdr.detectChanges();
    }
  });
}

  ngOnDestroy() {
    this.socket?.disconnect();
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  // ─── Carga de datos ───
  cargarMesaYCatalogo() {
    this.cargando = true;

    // Primero: info de la mesa (incluye id_sucursal)
    this.http.get<any>(`${this.apiUrl}/menu/mesa/${this.id_mesa}`).subscribe({
      next: (mesa) => {
        this.infoMesa   = mesa;
        this.id_sucursal = Number(mesa.id_sucursal) || 1;

        // Luego: catálogo de ESA sucursal
        this.cargarCatalogo();
      },
      error: () => {
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  cargarCatalogo() {
    this.http.get<any[]>(`${this.apiUrl}/menu/catalogo?id_sucursal=${this.id_sucursal}`).subscribe({
      next: (items) => {
        this.catalogo = items;

        // Construir lista de categorías únicas
        const cats = new Map<number, string>();
        items.forEach(i => cats.set(Number(i.id_categoria), i.nombre_categoria));
        this.categorias = Array.from(cats.entries()).map(([id, nombre]) => ({ id, nombre }));

        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  // ─── Catálogo filtrado ───
  get catalogoFiltrado(): any[] {
    return this.catalogo.filter(p => {
      const porCat  = !this.categoriaActiva || Number(p.id_categoria) === this.categoriaActiva;
      const porNomb = !this.busqueda || p.nombre_producto.toLowerCase().includes(this.busqueda.toLowerCase());
      return porCat && porNomb;
    });
  }

  // ─── Carrito ───
  agregarAlCarrito(producto: any) {
    const stock = Number(producto.stock_actual) || 0;

    if (stock <= 0) {
      alert('Este producto no está disponible por el momento.');
      return;
    }

    const item = this.carrito.find(i => i.id_producto === producto.id_producto);
    if (item) {
      item.cantidad++;
    } else {
      this.carrito.push({ ...producto, cantidad: 1, nota_cliente: '' });
    }

    // Decrementar stock visualizado (igual que POS, decrementa de 1 en 1)
    producto.stock_actual = stock - 1;
    this.cdr.detectChanges();
  }

  decrementarItem(item: any) {
    const prod = this.catalogo.find(p => p.id_producto === item.id_producto);
    if (item.cantidad > 1) {
      item.cantidad--;
      if (prod) prod.stock_actual = Number(prod.stock_actual) + 1;
    } else {
      this.quitarDelCarrito(item.id_producto);
    }
    this.cdr.detectChanges();
  }

  incrementarItem(item: any) {
    const prod  = this.catalogo.find(p => p.id_producto === item.id_producto);
    const stock = Number(prod?.stock_actual) || 0;
    if (stock <= 0) {
      alert('Sin más stock disponible');
      return;
    }
    item.cantidad++;
    if (prod) prod.stock_actual = stock - 1;
    this.cdr.detectChanges();
  }

  quitarDelCarrito(id: number) {
    const item = this.carrito.find(i => i.id_producto === id);
    if (item) {
      const prod = this.catalogo.find(p => p.id_producto === id);
      if (prod) prod.stock_actual = Number(prod.stock_actual) + item.cantidad;
      this.carrito = this.carrito.filter(i => i.id_producto !== id);
      this.cdr.detectChanges();
    }
  }

  get totalCarrito(): number {
    return this.carrito.reduce((s, i) => s + (Number(i.precio_unitario) * i.cantidad), 0);
  }

  get cantidadTotal(): number {
    return this.carrito.reduce((s, i) => s + i.cantidad, 0);
  }

  // ─── Enviar pedido ───
  enviarPedido() {
    if (!this.carrito.length) return;
    this.enviando   = true;
    this.errorEnvio = '';

    const payload = {
      id_mesa:             this.id_mesa,
      numero_mesa:         this.infoMesa?.numero_mesa,
      observacion_general: this.observacionGeneral || null,
      items: this.carrito.map(i => ({
        id_producto:     i.id_producto,
        cantidad:        i.cantidad,
        precio_unitario: Number(i.precio_unitario),
        nota_cliente:    i.nota_cliente || ''
      }))
    };

    this.http.post<any>(`${this.apiUrl}/menu/pedido`, payload).subscribe({
      next: (res) => {
        this.pedidoActual = {
          id_pedido: res.id_pedido,
          estado:    'Pendiente_Cajero',
          items:     [...this.carrito]
        };
        this.carrito            = [];
        this.observacionGeneral = '';
        this.enviando           = false;
        this.vistaActual        = 'tracking';
        this.iniciarTracking(res.id_pedido);
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorEnvio = 'Error al enviar. Intenta de nuevo.';
        this.enviando   = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Socket y tracking ───
  conectarSocket() {
    this.socket = io(this.socketUrl, { transports: ['websocket'] });

    // Escuchar actualizaciones de stock en tiempo real
    this.socket.on('stock:actualizado', (data: any) => {
      if (Number(data.id_sucursal) !== this.id_sucursal) return;

      // Actualizar stock en el catálogo visualmente
      data.productos?.forEach((p: any) => {
        const prod = this.catalogo.find(c => c.id_producto === p.id_producto);
        if (prod) {
          const stockItem = this.carrito.find(c => c.id_producto === p.id_producto)?.cantidad || 0;
          prod.stock_actual = Math.max(0, Number(prod.stock_actual) - p.cantidad_vendida + stockItem);
        }
      });
      this.cdr.detectChanges();
    });
  }

  iniciarTracking(id_pedido: number) {
    // Unirse a la sala de la mesa
    this.socket?.emit('unirse_sala', `mesa_${this.id_mesa}`);

    this.socket?.on('pedido_aprobado', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'En_Cocina';
        this.cdr.detectChanges();
      }
    });

    this.socket?.on('pedido_listo', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'Listo';
        if ('vibrate' in navigator) navigator.vibrate([300, 200, 300]);
        this.cdr.detectChanges();
      }
    });

    this.socket?.on('pedido_rechazado', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'Cancelado';
        this.cdr.detectChanges();
      }
    });

    // Polling de respaldo cada 15s
    this.pollInterval = setInterval(() => {
      if (!this.pedidoActual || ['Pagado', 'Cancelado'].includes(this.pedidoActual.estado)) {
        clearInterval(this.pollInterval);
        return;
      }
      this.http.get<any>(`${this.apiUrl}/menu/pedido/${id_pedido}`).subscribe({
        next: (p) => {
          if (p?.estado_pedido && p.estado_pedido !== this.pedidoActual.estado) {
            this.pedidoActual.estado = p.estado_pedido;
            this.cdr.detectChanges();
          }
        }
      });
    }, 15000);
  }

  isEstadoPasado(estadoActual: string, estadoCheck: string): boolean {
    const orden = ['Pendiente_Cajero', 'En_Cocina', 'Listo', 'Pagado'];
    return orden.indexOf(estadoActual) > orden.indexOf(estadoCheck);
  }

  getEstadoInfo(estado: string): { label: string; icon: string; color: string; desc: string } {
    const map: Record<string, any> = {
      'Pendiente_Cajero': { label: 'Esperando confirmación', icon: '⏳', color: 'text-amber-600',  desc: 'El cajero revisará tu pedido en breve...' },
      'En_Cocina':        { label: 'En preparación',         icon: '🍳', color: 'text-blue-600',   desc: 'Nuestro equipo está preparando tu pedido.' },
      'Listo':            { label: '¡Tu pedido está listo!', icon: '✅', color: 'text-green-600',  desc: 'El mozo llevará tu pedido a la mesa.' },
      'Cancelado':        { label: 'Pedido cancelado',       icon: '❌', color: 'text-red-600',    desc: 'El pedido fue cancelado. Consulta al cajero.' },
      'Pagado':           { label: 'Pagado. ¡Gracias!',      icon: '🎉', color: 'text-purple-600', desc: '¡Esperamos verte pronto!' }
    };
    return map[estado] ?? { label: estado, icon: '🔄', color: 'text-gray-600', desc: '' };
  }

  // URL imagen — soporta base64 y rutas relativas
  getImagenUrl(url: string | null): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http')) return url;
    // Ruta relativa del servidor
    return `${this.socketUrl}${url}`;
  }
}