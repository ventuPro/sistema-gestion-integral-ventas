import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MesaService } from '../../../core/services/mesa.service';
import { SocketService } from '../../../core/services/socket.service';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mesas.component.html',
  styleUrl: './mesas.component.css'
})
export class MesasComponent implements OnInit, OnDestroy {
  private mesaService    = inject(MesaService);
  private socketService  = inject(SocketService);
  private cdr            = inject(ChangeDetectorRef);

  mesas:          any[] = [];
  pedidosPendientes: any[] = [];
  cargando        = true;
  cargandoPedidos = false;

  // Modal nueva mesa
  mostrarModalMesa  = false;
  nuevaMesaNum      = '';
  errorMesa         = '';

  // Modal QR
  mostrarModalQR    = false;
  qrActual: any     = null;

  // Modal detalle pedido pendiente
  mostrarModalPedido = false;
  pedidoDetalle: any = null;

  // Notificación toast
  notificacion: string | null = null;

  ngOnInit() {
    this.cargarMesas();
    this.cargarPendientes();
    this.iniciarSocket();
  }

  ngOnDestroy() {
    this.socketService.desconectar();
  }

  iniciarSocket() {
    this.socketService.conectar('cajeros');

    // Nuevo pedido entrante
    this.socketService.escuchar<any>('nuevo_pedido_pendiente').subscribe(data => {
      this.mostrarToast(`🔔 Nuevo pedido — Mesa ${data.numero_mesa || data.id_mesa}`);
      this.cargarPendientes();
      this.cargarMesas();
      this.cdr.detectChanges();
    });

    // Mesa actualizada
    this.socketService.escuchar<any>('mesa_actualizada').subscribe(() => {
      this.cargarMesas();
      this.cdr.detectChanges();
    });

    // Ítem de cocina actualizado
    this.socketService.escuchar<any>('item_cocina_actualizado').subscribe(data => {
      if (data.pedido_listo) {
        this.mostrarToast(`✅ Pedido #${data.id_pedido} listo para entregar`);
        this.cargarMesas();
      }
    });
  }

  mostrarToast(msg: string) {
    this.notificacion = msg;
    setTimeout(() => { this.notificacion = null; this.cdr.detectChanges(); }, 4000);
  }

  cargarMesas() {
    this.mesaService.listarMesas(1).subscribe({
      next: (m) => { this.mesas = m; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarPendientes() {
    this.cargandoPedidos = true;
    this.mesaService.listarPendientesCajero(1).subscribe({
      next: (p) => { this.pedidosPendientes = p; this.cargandoPedidos = false; this.cdr.detectChanges(); },
      error: () => { this.cargandoPedidos = false; }
    });
  }

  // ─── Mesas ───
  abrirModalMesa() { this.nuevaMesaNum = ''; this.errorMesa = ''; this.mostrarModalMesa = true; }
  cerrarModalMesa() { this.mostrarModalMesa = false; }

  crearMesa() {
    if (!this.nuevaMesaNum || isNaN(+this.nuevaMesaNum)) { this.errorMesa = 'Ingresa un número válido.'; return; }
    this.mesaService.crearMesa({ id_sucursal: 1, numero_mesa: +this.nuevaMesaNum }).subscribe({
      next: () => { this.cerrarModalMesa(); this.cargarMesas(); },
      error: () => { this.errorMesa = 'Error al crear la mesa.'; }
    });
  }

  verQR(mesa: any) {
    this.qrActual = null;
    this.mostrarModalQR = true;
    this.mesaService.obtenerQR(mesa.id_mesa).subscribe({
      next: (res) => { this.qrActual = { ...res, numero_mesa: mesa.numero_mesa }; this.cdr.detectChanges(); },
      error: () => { this.mostrarModalQR = false; alert('Error al generar QR.'); }
    });
  }

  cerrarModalQR() { this.mostrarModalQR = false; this.qrActual = null; }

  descargarQR() {
    if (!this.qrActual) return;
    const a = document.createElement('a');
    a.href     = this.qrActual.qr;
    a.download = `QR_Mesa_${this.qrActual.numero_mesa}.png`;
    a.click();
  }

  getColorMesa(mesa: any): string {
    if (mesa.estado_pedido === 'Listo') return 'border-green-500 bg-green-50';
    if (mesa.estado_mesa   === 'Ocupada') return 'border-orange-400 bg-orange-50';
    return 'border-gray-200 bg-white';
  }

  getIconoMesa(mesa: any): string {
    if (mesa.estado_pedido === 'Listo')    return '✅';
    if (mesa.estado_pedido === 'En_Cocina') return '🍳';
    if (mesa.estado_mesa   === 'Ocupada')  return '🔴';
    return '🟢';
  }

  // ─── Pedidos pendientes ───
  verDetallePedido(pedido: any) { this.pedidoDetalle = pedido; this.mostrarModalPedido = true; }
  cerrarModalPedido() { this.mostrarModalPedido = false; this.pedidoDetalle = null; }

  aprobarPedido(id_pedido: number) {
    if (!confirm('¿Aprobar y enviar a cocina?')) return;
    this.mesaService.aprobarPedido(id_pedido).subscribe({
      next: () => { this.cerrarModalPedido(); this.cargarPendientes(); this.cargarMesas(); },
      error: () => alert('Error al aprobar.')
    });
  }

  rechazarPedido(id_pedido: number) {
    if (!confirm('¿Rechazar este pedido?')) return;
    this.mesaService.rechazarPedido(id_pedido).subscribe({
      next: () => { this.cerrarModalPedido(); this.cargarPendientes(); this.cargarMesas(); },
      error: () => alert('Error al rechazar.')
    });
  }
}