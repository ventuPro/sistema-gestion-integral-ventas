import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CuentaService }  from '../../../core/services/cuenta.service';
import { CajaService, EstadoCajaCompleto }    from '../../../core/services/caja.service';
import { MesaService }    from '../../../core/services/mesa.service';
import { SocketService }  from '../../../core/services/socket.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { MesaModalComponent } from './mesa-modal/mesa-modal.component';
import { LucideAngularModule,
         ShieldAlert, Landmark, RefreshCw, QrCode, Printer, Download, Plus, Trash2, X } from 'lucide-angular';
import { sondeo } from '../../../core/utils/sondeo';
import { cifra, fechaLarga } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MesaModalComponent, LucideAngularModule],
  templateUrl: './mesas.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css', './mesas.component.css']
})
export class MesasComponent implements OnInit, OnDestroy {
  private cuentaService = inject(CuentaService);
  private dialogo = inject(DialogoService);
  private cajaService   = inject(CajaService);
  private mesaService   = inject(MesaService);
  private socketService = inject(SocketService);
  private cdr           = inject(ChangeDetectorRef);
  readonly moneda        = inject(AjustesService).moneda;
  private ajustes       = inject(AjustesService);

  readonly icons = {
    shieldAlert: ShieldAlert,
    landmark:    Landmark,
    refresh:     RefreshCw,
    qr:          QrCode,
    printer:     Printer,
    download:    Download,
    mas:         Plus,
    quitar:      Trash2,
    cerrar:      X
  };

  readonly cifra    = cifra;
  readonly hoyTexto = fechaLarga(new Date());

  // ─── Control de acceso (basado en estado real del turno) ───
  verificandoCaja  = true;
  cajaHabilitada   = false;   // se mantiene por compatibilidad con el HTML
  estadoCaja: EstadoCajaCompleto['estado'] = 'SIN_APERTURA';
  turnoCajero: any = null;
  usuarioActual:   any = null;
  esAdmin          = false;

  // ─── Estado ───
  mesas:            any[] = [];
  cargando          = true;

  // ─── Modal nueva mesa ───
  mostrarModalMesa  = false;
  nuevaMesaNum      = '';
  errorMesa         = '';

  // ─── Modal mesa seleccionada ───
  mesaSeleccionada: any = null;

  // ─── Códigos QR ───
  private readonly CLAVE_URL_QR = 'qr_base_url_sgiv';
  mostrarModalQR  = false;
  baseUrlQR       = '';
  generandoQR     = false;
  errorQR         = '';
  codigosQR: { id_mesa: number; numero_mesa: number; qr: string; url: string }[] = [];

  // ─── Auto-refresh ───
  private detenerSondeo?: () => void;
  private readonly REFRESH_INTERVAL_MS = 30000; // 30 segundos
  private subs: Subscription[] = [];

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;

    this.verificarAccesoCaja();
  }

  ngOnDestroy() {
    // El socket lo comparte todo el panel: aquí solo se dejan de escuchar los eventos
    this.subs.forEach(s => s.unsubscribe());
    this.detenerSondeo?.();
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
    this.iniciarSocket();
    this.iniciarAutoRefresh();
  }

  // ─── AUTO-REFRESH ───
  private iniciarAutoRefresh() {
    this.detenerSondeo?.();
    this.detenerSondeo = sondeo(() => this.cargarMesas(), this.REFRESH_INTERVAL_MS);
  }

  // ─── SOCKET ───
  // Los pedidos QR se atienden en la bandeja (visible en todo el panel);
  // aquí solo se repinta el plano cuando cambian mesas o cuentas.
  iniciarSocket() {
    this.socketService.conectar('cajeros');

    const recargar = ['mesa:actualizada', 'cuenta:cerrada', 'cuenta:abierta',
                      'cuenta:producto_agregado', 'pedido:actualizado'];
    for (const evento of recargar)
      this.subs.push(this.socketService.escuchar<any>(evento).subscribe(() => this.cargarMesas()));

    this.subs.push(this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      this.dialogo.avisar(`Pedido QR cargado a la Mesa ${data.numero_mesa || ''}`);
      this.cargarMesas();
    }));
  }

  // ─── CARGA DE DATOS ───
  cargarMesas() {
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;
    this.cuentaService.getMesasConCuenta(id_sucursal).subscribe({
      next: (m) => { this.mesas = m; this.cargando = false; this.cdr.detectChanges(); },
      error: ()  => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  // ─── SELECCIONAR MESA ───
  seleccionarMesa(mesa: any) { this.mesaSeleccionada = mesa; }
  onModalCerrado()           { this.mesaSeleccionada = null; }
  onMesaActualizada()        { this.cargarMesas(); }

  // ─── ESTILOS ───
  claseMesa(mesa: any): string {
    if (mesa.id_cuenta) return 'cuenta';
    return mesa.estado_mesa === 'Ocupada' ? 'ocupada' : 'libre';
  }

  get resumen() {
    const conCuenta = this.mesas.filter(m => m.id_cuenta);
    return {
      libres:    this.mesas.filter(m => this.claseMesa(m) === 'libre').length,
      conCuenta: conCuenta.length,
      porCobrar: conCuenta.reduce((s, m) => s + (Number(m.total_acumulado) || 0), 0)
    };
  }

  // ─── NUEVA MESA ───
  abrirModalMesa()  { this.nuevaMesaNum = ''; this.errorMesa = ''; this.mostrarModalMesa = true; }
  cerrarModalMesa() { this.mostrarModalMesa = false; }

  crearMesa() {
    if (!this.nuevaMesaNum || isNaN(+this.nuevaMesaNum)) { this.errorMesa = 'Número inválido'; return; }
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;
    this.mesaService.crearMesa({ id_sucursal, numero_mesa: +this.nuevaMesaNum }).subscribe({
      next: () => { this.cerrarModalMesa(); this.cargarMesas(); },
      error: (e: any) => { this.errorMesa = e?.error?.error || 'Error al crear la mesa'; this.cdr.detectChanges(); }
    });
  }

  async eliminarMesa(mesa: any, event: Event) {
    event.stopPropagation(); // Evitar que abra el modal

    if (mesa.id_cuenta) {
      this.dialogo.error('No se puede eliminar: la mesa tiene una cuenta abierta.');
      return;
    }

    const si = await this.dialogo.confirmar({
      titulo: `¿Eliminar la Mesa ${mesa.numero_mesa}?`,
      mensaje: 'Esta acción no se puede deshacer. Su código QR impreso dejará de funcionar.',
      textoConfirmar: 'Eliminar', peligro: true
    });
    if (!si) return;

    this.mesaService.eliminarMesa(mesa.id_mesa).subscribe({
      next: () => {
        this.dialogo.avisar(`Mesa ${mesa.numero_mesa} eliminada`);
        this.cargarMesas();
      },
      error: (e: any) => this.dialogo.error(e?.error?.error || 'No se pudo eliminar la mesa.')
    });
  }

  // ─── CÓDIGOS QR ───
  // El QR lleva la dirección del sistema + el código aleatorio de la mesa.
  // Esa dirección debe poder abrirse desde el celular del cliente: si el
  // cajero entra por "localhost", hay que escribir la IP de la red local.
  abrirModalQR() {
    let guardada = '';
    try { guardada = localStorage.getItem(this.CLAVE_URL_QR) || ''; } catch { }
    this.baseUrlQR      = guardada || window.location.origin;
    this.codigosQR      = [];
    this.errorQR        = '';
    this.mostrarModalQR = true;
    this.generarCodigosQR();
  }

  cerrarModalQR() { this.mostrarModalQR = false; }

  get baseUrlEsLocal(): boolean {
    try {
      const host = new URL(this.baseUrlQR).hostname;
      return host === 'localhost' || host.startsWith('127.') || host === '[::1]';
    } catch { return false; }
  }

  generarCodigosQR() {
    const base = this.baseUrlQR.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(base)) {
      this.errorQR = 'Escribe la dirección completa, por ejemplo http://192.168.1.10:4200';
      return;
    }
    this.baseUrlQR = base;
    try { localStorage.setItem(this.CLAVE_URL_QR, base); } catch { }

    if (!this.mesas.length) { this.codigosQR = []; return; }
    this.generandoQR = true;
    this.errorQR     = '';
    this.mesaService.obtenerQRSucursal(this.usuarioActual?.id_sucursal || 1, base).subscribe({
      next: (codigos) => {
        this.codigosQR   = codigos;
        this.generandoQR = false;
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        this.errorQR     = e?.error?.error || 'No se pudieron generar los códigos.';
        this.generandoQR = false;
        this.cdr.detectChanges();
      }
    });
  }

  descargarQR(c: { numero_mesa: number; qr: string }) {
    const a = document.createElement('a');
    a.href     = c.qr;
    a.download = `QR_Mesa_${c.numero_mesa}.png`;
    a.click();
  }

  async regenerarQR(c: { id_mesa: number; numero_mesa: number }) {
    const si = await this.dialogo.confirmar({
      titulo: `¿Generar un QR nuevo para la Mesa ${c.numero_mesa}?`,
      mensaje: 'El QR impreso actual dejará de funcionar y deberás imprimir y pegar el nuevo.',
      textoConfirmar: 'Generar nuevo QR', peligro: true
    });
    if (!si) return;
    this.mesaService.regenerarQR(c.id_mesa).subscribe({
      next: (r: any) => { this.dialogo.avisar(r.mensaje); this.generarCodigosQR(); },
      error: (e: any) => this.dialogo.error(e?.error?.error || 'No se pudo regenerar el QR')
    });
  }

  /** Hoja imprimible en una ventana aparte: no arrastra el resto del sistema */
  imprimirQR() {
    const nombre = this.escaparHtml(this.ajustes.nombre());
    const logo   = this.ajustes.logo() ? `<img class="logo" src="${this.ajustes.logo()}" alt="">` : '';
    const color  = `rgb(${this.ajustes.colorPrimarioRgb().join(',')})`;
    const tarjetas = this.codigosQR.map(c => `
      <div class="tarjeta">
        ${logo}<p class="marca">${nombre}</p>
        <img src="${c.qr}" alt="QR Mesa ${c.numero_mesa}">
        <p class="mesa">Mesa ${c.numero_mesa}</p>
        <p class="ayuda">Escanea para ver el menú y pedir desde tu mesa</p>
      </div>`).join('');

    const ventana = window.open('', '_blank');
    if (!ventana) { this.dialogo.error('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.'); return; }
    ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Códigos QR de mesas</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 12mm; }
        .hoja { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
        .tarjeta { border: 2px dashed #999; border-radius: 6mm; padding: 6mm; text-align: center; break-inside: avoid; }
        .tarjeta img { width: 60mm; height: 60mm; }
        .marca { margin: 0 0 2mm; font-weight: bold; color: ${color}; }
        .tarjeta img.logo { width: auto; height: 14mm; margin-bottom: 1mm; }
        .mesa  { margin: 2mm 0 0; font-size: 22pt; font-weight: 900; }
        .ayuda { margin: 1mm 0 0; font-size: 10pt; color: #555; }
      </style></head>
      <body><div class="hoja">${tarjetas}</div>
      <script>window.onload = () => { window.print(); }<\/script></body></html>`);
    ventana.document.close();
  }

  private escaparHtml(texto: string): string {
    return texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }
}
