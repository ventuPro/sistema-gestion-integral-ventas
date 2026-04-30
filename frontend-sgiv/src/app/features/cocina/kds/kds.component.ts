import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KdsService } from '../../../core/services/kds.service';
import { SocketService } from '../../../core/services/socket.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-kds',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kds.component.html',
  styleUrl: './kds.component.css'
})
export class KdsComponent implements OnInit, OnDestroy {
  private kdsService    = inject(KdsService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);
  private router        = inject(Router);

  pedidos:    any[]   = [];
  cargando    = true;
  horaActual  = new Date();
  usuario: any = null;

  private tickInterval: any;

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) this.usuario = JSON.parse(raw);

    // Verificar que sea cocina o admin
    if (this.usuario && this.usuario.id_rol !== 3 && this.usuario.id_rol !== 1) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.cargarPedidos();
    this.iniciarSocket();

    // Reloj en tiempo real
    this.tickInterval = setInterval(() => {
      this.horaActual = new Date();
      this.cdr.detectChanges();
    }, 1000);
  }

  ngOnDestroy() {
    this.socketService.desconectar();
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  iniciarSocket() {
    this.socketService.conectar('cocina');

    // Nuevo pedido llega a cocina
    this.socketService.escuchar<any>('nuevo_pedido_cocina').subscribe(pedido => {
      // Agregar o actualizar pedido en la lista
      const idx = this.pedidos.findIndex(p => p.id_pedido === pedido.id_pedido);
      if (idx === -1) {
        this.pedidos.unshift(pedido);
      } else {
        this.pedidos[idx] = pedido;
      }
      this.cdr.detectChanges();
      this.sonarNotificacion();
    });
  }

  sonarNotificacion() {
    // Vibración en móvil si está disponible
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }

  cargarPedidos() {
    this.kdsService.obtenerPedidosKDS(1).subscribe({
      next: (p) => { this.pedidos = p; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  actualizarItem(id_detalle: number, nuevo_estado: string, pedidoIdx: number, itemIdx: number) {
    this.kdsService.actualizarItem(id_detalle, nuevo_estado).subscribe({
      next: (res) => {
        // Actualizar localmente sin recargar
        this.pedidos[pedidoIdx].items[itemIdx].estado_cocina = nuevo_estado;

        if (res.resultado?.pedido_listo) {
          this.pedidos[pedidoIdx].estado_pedido = 'Listo';
        }
        this.cdr.detectChanges();
      },
      error: () => alert('Error al actualizar.')
    });
  }

  getSiguienteEstado(estado: string): string | null {
    if (estado === 'Pendiente')      return 'En_Preparacion';
    if (estado === 'En_Preparacion') return 'Listo';
    return null;
  }

  getLabelBoton(estado: string): string {
    if (estado === 'Pendiente')      return '▶ Iniciar';
    if (estado === 'En_Preparacion') return '✓ Listo';
    return '';
  }

  getColorItem(estado: string): string {
    if (estado === 'Listo')          return 'border-green-400 bg-green-50';
    if (estado === 'En_Preparacion') return 'border-amber-400 bg-amber-50';
    return 'border-gray-200 bg-white';
  }

  getColorPedido(pedido: any): string {
    if (pedido.estado_pedido === 'Listo') return 'border-green-400';
    const tieneEnPrep = pedido.items?.some((i: any) => i.estado_cocina === 'En_Preparacion');
    if (tieneEnPrep) return 'border-amber-400';
    return 'border-gray-300';
  }

  tiempoDesde(fecha: string): string {
    const diff = Math.floor((new Date().getTime() - new Date(fecha).getTime()) / 60000);
    if (diff < 1) return 'Ahora';
    if (diff === 1) return '1 min';
    return `${diff} min`;
  }

  cerrarSesion() {
    localStorage.removeItem('token_sgiv');
    localStorage.removeItem('usuario_sgiv');
    this.router.navigate(['/login']);
  }
}