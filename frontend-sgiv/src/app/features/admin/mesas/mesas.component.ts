import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CuentaService } from '../../../core/services/cuenta.service';
import { SocketService } from '../../../core/services/socket.service';
import { MesaModalComponent } from './mesa-modal/mesa-modal.component';
import { MesaService } from '../../../core/services/mesa.service';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [CommonModule, FormsModule, MesaModalComponent],
  templateUrl: './mesas.component.html',
  styleUrl:    './mesas.component.css'
})
export class MesasComponent implements OnInit, OnDestroy {
  private cuentaService = inject(CuentaService);
  private mesaService   = inject(MesaService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);

  mesas:           any[] = [];
  pedidosPendientes: any[] = [];
  cargando         = true;
  notificacion: string | null = null;

  // Modal nueva mesa
  mostrarModalMesa = false;
  nuevaMesaNum     = '';
  errorMesa        = '';

  // Modal de mesa seleccionada
  mesaSeleccionada: any = null;

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

    // Nuevo pedido QR pendiente
    this.socketService.escuchar<any>('nuevo_pedido_pendiente').subscribe(() => {
      this.mostrarToast('🔔 Nuevo pedido QR recibido');
      this.cargarPendientes();
      this.cargarMesas();
      this.cdr.detectChanges();
    });

    // Mesa actualizada (cuenta abierta, cerrada, producto agregado)
    this.socketService.escuchar<any>('mesa:actualizada').subscribe(() => {
      this.cargarMesas();
      this.cdr.detectChanges();
    });

    // Pedido QR integrado en comanda
    this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      this.mostrarToast(`🍽 Pedido QR integrado en Mesa ${data.numero_mesa}`);
      this.cargarMesas();
      this.cdr.detectChanges();
    });

    // Cuenta cerrada
    this.socketService.escuchar<any>('cuenta:cerrada').subscribe(() => {
      this.cargarMesas();
      this.cdr.detectChanges();
    });
  }

  mostrarToast(msg: string) {
    this.notificacion = msg;
    setTimeout(() => { this.notificacion = null; this.cdr.detectChanges(); }, 4000);
  }

  cargarMesas() {
    const usr = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    const id_sucursal = usr.id_sucursal || 1;

    this.cuentaService.getMesasConCuenta(id_sucursal).subscribe({
      next: (m) => { this.mesas = m; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; }
    });
  }

  cargarPendientes() {
    const usr = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    this.mesaService.listarPendientesCajero(usr.id_sucursal || 1).subscribe({
      next: (p) => { this.pedidosPendientes = p; this.cdr.detectChanges(); }
    });
  }

  // Abre el modal al hacer clic en una mesa
  seleccionarMesa(mesa: any) {
    this.mesaSeleccionada = mesa;
  }

  onModalCerrado() {
    this.mesaSeleccionada = null;
  }

  onMesaActualizada() {
    this.cargarMesas();
    this.cargarPendientes();
  }

  // Colores y estilos del plano
  getEstiloMesa(mesa: any) {
    if (mesa.id_cuenta) {
      // Mesa con comanda abierta
      return 'border-orange-400 bg-orange-50 hover:bg-orange-100';
    }
    if (mesa.estado_mesa === 'Ocupada') {
      return 'border-red-400 bg-red-50 hover:bg-red-100';
    }
    return 'border-green-300 bg-green-50 hover:bg-green-100';
  }

  getIconoMesa(mesa: any) {
    if (mesa.id_cuenta)           return '🟠';
    if (mesa.estado_mesa === 'Ocupada') return '🔴';
    return '🟢';
  }

  // Nueva mesa
  abrirModalMesa()  { this.nuevaMesaNum = ''; this.errorMesa = ''; this.mostrarModalMesa = true; }
  cerrarModalMesa() { this.mostrarModalMesa = false; }

  crearMesa() {
    if (!this.nuevaMesaNum || isNaN(+this.nuevaMesaNum)) { this.errorMesa = 'Número inválido'; return; }
    const usr = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
    this.mesaService.crearMesa({ id_sucursal: usr.id_sucursal || 1, numero_mesa: +this.nuevaMesaNum }).subscribe({
      next: () => { this.cerrarModalMesa(); this.cargarMesas(); },
      error: () => { this.errorMesa = 'Error al crear la mesa'; }
    });
  }

  // Pedidos pendientes
  aprobarPedido(id_pedido: number) {
    this.mesaService.aprobarPedido(id_pedido).subscribe({
      next: () => { this.cargarPendientes(); this.cargarMesas(); },
      error: () => alert('Error al aprobar')
    });
  }

  rechazarPedido(id_pedido: number) {
    this.mesaService.rechazarPedido(id_pedido).subscribe({
      next: () => this.cargarPendientes(),
      error: () => alert('Error al rechazar')
    });
  }
}