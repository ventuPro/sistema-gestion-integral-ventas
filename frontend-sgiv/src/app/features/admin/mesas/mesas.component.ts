import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CuentaService }  from '../../../core/services/cuenta.service';
import { CajaService, EstadoCajaCompleto }    from '../../../core/services/caja.service';
import { MesaService }    from '../../../core/services/mesa.service';
import { SocketService }  from '../../../core/services/socket.service';
import { MesaModalComponent } from './mesa-modal/mesa-modal.component';
import { LucideAngularModule,
         ShieldAlert, Landmark, RefreshCw } from 'lucide-angular';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [CommonModule, FormsModule, MesaModalComponent, LucideAngularModule],
  templateUrl: './mesas.component.html',
  styleUrl:    './mesas.component.css'
})
export class MesasComponent implements OnInit, OnDestroy {
  private cuentaService = inject(CuentaService);
  private cajaService   = inject(CajaService);
  private mesaService   = inject(MesaService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);

  readonly icons = {
    shieldAlert: ShieldAlert,
    landmark:    Landmark,
    refresh:     RefreshCw
  };

  // ─── Control de acceso (basado en estado real del turno) ───
  verificandoCaja  = true;
  cajaHabilitada   = false;   // se mantiene por compatibilidad con el HTML
  estadoCaja: EstadoCajaCompleto['estado'] = 'SIN_APERTURA';
  turnoCajero: any = null;
  usuarioActual:   any = null;
  esAdmin          = false;

  // ─── Estado ───
  mesas:            any[] = [];
  pedidosPendientes: any[] = [];
  cargando          = true;
  notificacion: string | null = null;

  // ─── Modal nueva mesa ───
  mostrarModalMesa  = false;
  nuevaMesaNum      = '';
  errorMesa         = '';

  // ─── Modal mesa seleccionada ───
  mesaSeleccionada: any = null;

  // ─── Auto-refresh ───
  private refreshInterval: any;
  private readonly REFRESH_INTERVAL_MS = 30000; // 30 segundos

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;

    this.verificarAccesoCaja();
  }

  ngOnDestroy() {
    this.socketService.desconectar();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  // ─── VERIFICAR ACCESO (usa el estado real del turno) ───
  verificarAccesoCaja() {
    // Admin siempre tiene acceso
    if (this.esAdmin) {
      this.cajaHabilitada  = true;
      this.estadoCaja      = 'ABIERTA';
      this.verificandoCaja = false;
      this.inicializar();
      return;
    }

    this.cajaService.obtenerEstadoCompleto().subscribe({
      next: (res) => {
        this.estadoCaja     = res.estado;
        this.cajaHabilitada = res.puede_vender;
        this.turnoCajero    = res.turno;
        this.verificandoCaja = false;

        // Sincronizar localStorage
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = res.caja_habilitada;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }

        if (res.puede_vender) this.inicializar();
        else this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cajaHabilitada  = false;
        this.estadoCaja      = 'SIN_APERTURA';
        this.verificandoCaja = false;
        this.cargando        = false;
        this.cdr.detectChanges();
      }
    });
  }

  private inicializar() {
    this.cargarMesas();
    this.cargarPendientes();
    this.iniciarSocket();
    this.iniciarAutoRefresh();
  }

  // ─── AUTO-REFRESH ───
  private iniciarAutoRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => {
      this.cargarMesas();
      this.cargarPendientes();
    }, this.REFRESH_INTERVAL_MS);
  }

  // ─── SOCKET ───
  iniciarSocket() {
    this.socketService.conectar('cajeros');

    this.socketService.escuchar<any>('nuevo_pedido_pendiente').subscribe(() => {
      this.mostrarToast('🔔 Nuevo pedido QR recibido');
      this.cargarPendientes();
      this.cargarMesas();
    });

    this.socketService.escuchar<any>('mesa:actualizada').subscribe(() => {
      this.cargarMesas();
    });

    this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      this.mostrarToast(`🍽 Pedido QR integrado en Mesa ${data.numero_mesa || ''}`);
      this.cargarMesas();
    });

    this.socketService.escuchar<any>('cuenta:cerrada').subscribe(() => {
      this.cargarMesas();
    });

    this.socketService.escuchar<any>('cuenta:abierta').subscribe(() => {
      this.cargarMesas();
    });

    this.socketService.escuchar<any>('cuenta:producto_agregado').subscribe(() => {
      this.cargarMesas();
    });
  }

  mostrarToast(msg: string) {
    this.notificacion = msg;
    this.cdr.detectChanges();
    setTimeout(() => { this.notificacion = null; this.cdr.detectChanges(); }, 4000);
  }

  // ─── CARGA DE DATOS ───
  cargarMesas() {
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;
    this.cuentaService.getMesasConCuenta(id_sucursal).subscribe({
      next: (m) => { this.mesas = m; this.cargando = false; this.cdr.detectChanges(); },
      error: ()  => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarPendientes() {
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;
    this.mesaService.listarPendientesCajero(id_sucursal).subscribe({
      next: (p) => { this.pedidosPendientes = p; this.cdr.detectChanges(); }
    });
  }

  // ─── SELECCIONAR MESA ───
  seleccionarMesa(mesa: any) { this.mesaSeleccionada = mesa; }
  onModalCerrado()           { this.mesaSeleccionada = null; }
  onMesaActualizada()        { this.cargarMesas(); this.cargarPendientes(); }

  // ─── ESTILOS ───
  getEstiloMesa(mesa: any): string {
    if (mesa.id_cuenta)             return 'border-orange-400 bg-orange-50 hover:bg-orange-100';
    if (mesa.estado_mesa === 'Ocupada') return 'border-red-400 bg-red-50 hover:bg-red-100';
    return 'border-green-300 bg-green-50 hover:bg-green-100';
  }

  getIconoMesa(mesa: any): string {
    if (mesa.id_cuenta)             return '🟠';
    if (mesa.estado_mesa === 'Ocupada') return '🔴';
    return '🟢';
  }

  // ─── NUEVA MESA ───
  abrirModalMesa()  { this.nuevaMesaNum = ''; this.errorMesa = ''; this.mostrarModalMesa = true; }
  cerrarModalMesa() { this.mostrarModalMesa = false; }

  crearMesa() {
    if (!this.nuevaMesaNum || isNaN(+this.nuevaMesaNum)) { this.errorMesa = 'Número inválido'; return; }
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;
    this.mesaService.crearMesa({ id_sucursal, numero_mesa: +this.nuevaMesaNum }).subscribe({
      next: () => { this.cerrarModalMesa(); this.cargarMesas(); },
      error: () => { this.errorMesa = 'Error al crear la mesa'; }
    });
  }

  // ─── PEDIDOS PENDIENTES ───
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

  eliminarMesa(mesa: any, event: Event) {
  event.stopPropagation(); // Evitar que abra el modal

  if (mesa.id_cuenta) {
    alert('No se puede eliminar: la mesa tiene una cuenta abierta.');
    return;
  }

  if (!confirm(`¿Eliminar definitivamente la Mesa ${mesa.numero_mesa}?\nEsta acción no se puede deshacer.`)) return;

  this.mesaService.eliminarMesa(mesa.id_mesa).subscribe({
    next: () => {
      this.mostrarToast(`🗑 Mesa ${mesa.numero_mesa} eliminada`);
      this.cargarMesas();
    },
    error: (e: any) => {
      alert(e?.error?.error || 'Error al eliminar la mesa.');
    }
  });
}
}