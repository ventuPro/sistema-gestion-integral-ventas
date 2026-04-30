import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../../environments/environment';

type Vista = 'catalogo' | 'carrito' | 'tracking';

@Component({
  selector: 'app-menu-digital',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './menu-digital.component.html',
  styleUrl: './menu-digital.component.css'
})
export class MenuDigitalComponent implements OnInit, OnDestroy {
  private route  = inject(ActivatedRoute);
  private http   = inject(HttpClient);
  private cdr    = inject(ChangeDetectorRef);
  private apiUrl = environment.apiUrl;

  id_mesa      = 0;
  infoMesa:    any   = null;
  catalogo:    any[] = [];
  categorias:  any[] = [];
  carrito:     any[] = [];
  cargando     = true;
  enviando     = false;

  vistaActual: Vista          = 'catalogo';
  categoriaActiva: number | null = null;

  observacionGeneral = '';
  pedidoActual: any  = null;
  errorEnvio         = '';

  private socket: Socket | null = null;

  ngOnInit() {
    this.id_mesa = +this.route.snapshot.paramMap.get('id_mesa')!;
    this.cargarDatos();
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }

  cargarDatos() {
    this.cargando = true;

    this.http.get<any>(`${this.apiUrl}/menu/mesa/${this.id_mesa}`).subscribe({
      next: (mesa) => { this.infoMesa = mesa; this.cdr.detectChanges(); },
      error: () => {}
    });

    // FIX: tipo explícito any[]
    this.http.get<any[]>(`${this.apiUrl}/menu/catalogo?id_sucursal=1`).subscribe({
      next: (items) => {
        this.catalogo = items;
        const cats = new Map<number, string>();
        items.forEach(i => cats.set(i.id_categoria, i.nombre_categoria));
        this.categorias = Array.from(cats.entries()).map(([id, nombre]) => ({ id, nombre }));
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  get catalogoFiltrado(): any[] {
    if (!this.categoriaActiva) return this.catalogo;
    return this.catalogo.filter(p => p.id_categoria === this.categoriaActiva);
  }

  agregarAlCarrito(producto: any) {
    const item = this.carrito.find(i => i.id_producto === producto.id_producto);
    if (item) {
      if (item.cantidad < producto.stock_actual) item.cantidad++;
    } else {
      this.carrito.push({ ...producto, cantidad: 1, nota_cliente: '' });
    }
    this.cdr.detectChanges();
  }

  // FIX: métodos separados para decrementar e incrementar
  decrementarItem(item: any) {
    if (item.cantidad > 1) {
      item.cantidad--;
    } else {
      this.quitarDelCarrito(item.id_producto);
    }
  }

  incrementarItem(item: any) {
    if (item.cantidad < item.stock_actual) {
      item.cantidad++;
    }
  }

  quitarDelCarrito(id: number) {
    this.carrito = this.carrito.filter(i => i.id_producto !== id);
  }

  get totalCarrito(): number {
    return this.carrito.reduce((s, i) => s + (i.precio_unitario * i.cantidad), 0);
  }

  get cantidadTotal(): number {
    return this.carrito.reduce((s, i) => s + i.cantidad, 0);
  }

  enviarPedido() {
    if (this.carrito.length === 0) return;
    this.enviando   = true;
    this.errorEnvio = '';

    const payload = {
      id_mesa:             this.id_mesa,
      numero_mesa:         this.infoMesa?.numero_mesa,
      observacion_general: this.observacionGeneral,
      items: this.carrito.map(i => ({
        id_producto:     i.id_producto,
        cantidad:        i.cantidad,
        precio_unitario: i.precio_unitario,
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
        this.errorEnvio = 'Error al enviar el pedido. Intenta de nuevo.';
        this.enviando   = false;
        this.cdr.detectChanges();
      }
    });
  }

  iniciarTracking(id_pedido: number) {
    this.socket = io('http://localhost:3000', { transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.socket?.emit('unirse_sala', `mesa_${this.id_mesa}`);
    });

    this.socket.on('pedido_aprobado', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'En_Cocina';
        this.cdr.detectChanges();
      }
    });

    this.socket.on('pedido_listo', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'Listo';
        this.cdr.detectChanges();
        if ('vibrate' in navigator) navigator.vibrate([300, 200, 300]);
      }
    });

    this.socket.on('pedido_rechazado', (data: any) => {
      if (data.id_pedido === id_pedido) {
        this.pedidoActual.estado = 'Cancelado';
        this.cdr.detectChanges();
      }
    });

    // Polling de respaldo cada 15s
    const poll = setInterval(() => {
      if (!this.pedidoActual || this.pedidoActual.estado === 'Pagado') {
        clearInterval(poll); return;
      }
      this.http.get<any>(`${this.apiUrl}/menu/pedido/${id_pedido}`).subscribe({
        next: (p) => {
          if (p.estado_pedido !== this.pedidoActual.estado) {
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
    const map: Record<string, { label: string; icon: string; color: string; desc: string }> = {
      'Pendiente_Cajero': { label: 'Esperando confirmación', icon: '⏳', color: 'text-amber-600',  desc: 'El cajero está revisando tu pedido...' },
      'En_Cocina':        { label: 'En preparación',         icon: '🍳', color: 'text-blue-600',   desc: 'Nuestro equipo está preparando tu pedido.' },
      'Listo':            { label: '¡Tu pedido está listo!', icon: '✅', color: 'text-green-600',  desc: 'El mozo llevará tu pedido a la mesa.' },
      'Cancelado':        { label: 'Pedido cancelado',       icon: '❌', color: 'text-red-600',    desc: 'El pedido fue cancelado. Consulta al cajero.' },
      'Pagado':           { label: 'Pagado. ¡Gracias!',      icon: '🎉', color: 'text-purple-600', desc: '¡Esperamos verte pronto!' }
    };
    return map[estado] ?? { label: estado, icon: '🔄', color: 'text-gray-600', desc: '' };
  }
}