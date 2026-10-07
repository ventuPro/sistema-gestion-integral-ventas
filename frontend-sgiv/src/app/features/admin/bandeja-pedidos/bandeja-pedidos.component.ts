import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LucideAngularModule, Bell, X, Check, Minus, Plus, Trash2, Volume2, VolumeX, Truck } from 'lucide-angular';
import { PedidoService } from '../../../core/services/pedido.service';
import { SocketService } from '../../../core/services/socket.service';

type Pestana = 'pendientes' | 'entregar';

// ─── Bandeja de pedidos QR (visible en todo el panel del cajero) ───
@Component({
  selector:    'app-bandeja-pedidos',
  standalone:  true,
  imports:     [CommonModule, LucideAngularModule],
  templateUrl: './bandeja-pedidos.component.html'
})
export class BandejaPedidosComponent implements OnInit, OnDestroy {
  private pedidoService = inject(PedidoService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);

  readonly icons = { bell: Bell, x: X, check: Check, minus: Minus, plus: Plus,
                     trash: Trash2, sonido: Volume2, silencio: VolumeX, delivery: Truck };

  private readonly RECORDATORIO_MS = 60_000;
  private readonly RESPALDO_MS     = 30_000;
  private readonly CLAVE_SONIDO    = 'bandeja_sonido_sgiv';

  abierta  = false;
  pestana: Pestana = 'pendientes';
  pendientes: any[] = [];
  porEntregar: any[] = [];
  ocupado: Record<number, boolean> = {};
  errores: Record<number, string> = {};
  aviso: string | null = null;
  sonidoActivo = true;
  ahora = Date.now();

  private idSucursal = 1;
  private subs: Subscription[] = [];
  private timers: any[] = [];
  private recarga: any = null;
  private audio: AudioContext | null = null;
  private tituloOriginal = document.title;

  ngOnInit() {
    try {
      this.idSucursal   = Number(JSON.parse(localStorage.getItem('usuario_sgiv') || '{}').id_sucursal) || 1;
      this.sonidoActivo = localStorage.getItem(this.CLAVE_SONIDO) !== 'no';
    } catch { /* valores por defecto */ }

    document.addEventListener('click', this.desbloquearAudio, { once: true });
    this.cargar();
    this.socketService.conectar('cajeros');

    this.subs.push(this.socketService.escuchar<any>('pedido:nuevo').subscribe(d => {
      if (!this.esDeMiSucursal(d)) return;
      this.sonar();
      this.mostrarAviso(`🔔 Nuevo pedido de la Mesa ${d.numero_mesa}`);
      this.cargar();
    }));
    this.subs.push(this.socketService.escuchar<any>('pedido:actualizado').subscribe(d => {
      if (this.esDeMiSucursal(d)) this.cargarPronto();
    }));

    this.timers.push(setInterval(() => this.cargar(), this.RESPALDO_MS));
    this.timers.push(setInterval(() => {
      if (this.pendientes.length > 0) this.sonar();
    }, this.RECORDATORIO_MS));
    this.timers.push(setInterval(() => { this.ahora = Date.now(); this.cdr.detectChanges(); }, 30_000));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.timers.forEach(t => clearInterval(t));
    if (this.recarga) clearTimeout(this.recarga);
    document.removeEventListener('click', this.desbloquearAudio);
    document.title = this.tituloOriginal;
    this.audio?.close();
  }

  private esDeMiSucursal(d: any): boolean {
    return !d?.id_sucursal || Number(d.id_sucursal) === this.idSucursal;
  }

  // ─── Carga ───
  cargar() {
    this.pedidoService.bandeja().subscribe({
      next: (lista) => {
        this.pendientes  = lista.filter(p => p.estado_pedido === 'Pendiente_Cajero');
        this.porEntregar = lista.filter(p => p.estado_pedido === 'Confirmado');
        document.title = this.pendientes.length
          ? `(${this.pendientes.length}) ${this.tituloOriginal}`
          : this.tituloOriginal;
        this.cdr.detectChanges();
      },
      error: () => { /* sin permiso o sin conexión: la bandeja queda como estaba */ }
    });
  }

  private cargarPronto() {
    if (this.recarga) clearTimeout(this.recarga);
    this.recarga = setTimeout(() => { this.recarga = null; this.cargar(); }, 250);
  }

  // ─── Panel ───
  alternar() {
    this.abierta = !this.abierta;
    if (this.abierta) {
      this.pestana = this.pendientes.length || !this.porEntregar.length ? 'pendientes' : 'entregar';
      this.prepararAudio();
    }
  }

  alternarSonido() {
    this.sonidoActivo = !this.sonidoActivo;
    try { localStorage.setItem(this.CLAVE_SONIDO, this.sonidoActivo ? 'si' : 'no'); } catch { }
    if (this.sonidoActivo) { this.prepararAudio(); this.sonar(); }
  }

  // ─── Acciones del cajero ───
  cambiarCantidad(pedido: any, item: any, cantidad: number) {
    if (cantidad < 0) return;
    if (cantidad === 0 && pedido.items.length === 1) {
      this.errores[pedido.id_pedido] = 'Es el único producto: si no se puede atender, rechaza el pedido.';
      return;
    }
    this.ejecutar(pedido, this.pedidoService.ajustarCantidad(pedido.id_pedido, item.id_detalle, cantidad));
  }

  confirmar(pedido: any) {
    this.ejecutar(pedido, this.pedidoService.confirmar(pedido.id_pedido),
                  `✓ Pedido de la Mesa ${pedido.numero_mesa} confirmado y cargado a su cuenta`);
  }

  rechazar(pedido: any) {
    if (!confirm(`¿Rechazar el pedido de la Mesa ${pedido.numero_mesa}?`)) return;
    this.ejecutar(pedido, this.pedidoService.rechazar(pedido.id_pedido),
                  `Pedido de la Mesa ${pedido.numero_mesa} rechazado`);
  }

  entregado(pedido: any) {
    this.ejecutar(pedido, this.pedidoService.marcarEntregado(pedido.id_pedido));
  }

  private ejecutar(pedido: any, accion: any, exito?: string) {
    const id = pedido.id_pedido;
    if (this.ocupado[id]) return;
    this.ocupado[id] = true;
    delete this.errores[id];

    accion.subscribe({
      next: () => {
        delete this.ocupado[id];
        if (exito) this.mostrarAviso(exito);
        this.cargar();
      },
      error: (e: any) => {
        delete this.ocupado[id];
        this.errores[id] = e?.error?.error || 'No se pudo completar la acción. Intenta de nuevo.';
        if (e?.status === 409 || e?.status === 404) this.cargar();
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Utilidades de la vista ───
  minutos(fecha: string): string {
    const min = Math.max(0, Math.floor((this.ahora - new Date(fecha).getTime()) / 60000));
    return min === 0 ? 'recién' : `hace ${min} min`;
  }

  minutosRestantes(pedido: any): number {
    return Math.max(0, Math.ceil((new Date(pedido.fecha_expiracion).getTime() - this.ahora) / 60000));
  }

  porVencer(pedido: any): boolean {
    return this.minutosRestantes(pedido) <= 5;
  }

  etiqueta(pedido: any): string {
    return pedido.tipo_pedido === 'Delivery'
      ? `Delivery · ${pedido.nombre_cliente || 'Cliente'}`
      : `Mesa ${pedido.numero_mesa}`;
  }

  private mostrarAviso(msg: string) {
    this.aviso = msg;
    this.cdr.detectChanges();
    setTimeout(() => { if (this.aviso === msg) { this.aviso = null; this.cdr.detectChanges(); } }, 4000);
  }

  // ─── Sonido (requiere un clic previo en la página) ───
  private desbloquearAudio = () => this.prepararAudio();

  private prepararAudio() {
    try {
      if (!this.audio) this.audio = new AudioContext();
      if (this.audio.state === 'suspended') this.audio.resume();
    } catch { this.audio = null; }
  }

  private sonar() {
    if (!this.sonidoActivo) return;
    this.prepararAudio();
    const ctx = this.audio;
    if (!ctx) return;
    [0, 0.18].forEach((retardo, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1175;
      const t = ctx.currentTime + retardo;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }
}
