import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
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
         ShieldAlert, Landmark, RefreshCw, QrCode, Printer, Download, Plus, Trash2, X,
         DoorOpen, DoorClosed, Ticket } from 'lucide-angular';
import { sondeo } from '../../../core/utils/sondeo';
import { cifra, fechaLarga } from '../../../core/utils/informe';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';

@Component({
  selector: 'app-mesas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MesaModalComponent, LucideAngularModule],
  templateUrl: './mesas.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css', './mesas.component.css']
})
export class MesasComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private cuentaService = inject(CuentaService);
  private dialogo = inject(DialogoService);
  private cajaService   = inject(CajaService);
  private mesaService   = inject(MesaService);
  private socketService = inject(SocketService);
  readonly moneda        = inject(AjustesService).moneda;
  readonly ajustes      = inject(AjustesService);

  readonly icons = {
    shieldAlert: ShieldAlert,
    landmark:    Landmark,
    refresh:     RefreshCw,
    qr:          QrCode,
    printer:     Printer,
    download:    Download,
    mas:         Plus,
    quitar:      Trash2,
    cerrar:      X,
    habilitar:   DoorOpen,
    liberar:     DoorClosed,
    qrVisita:    Ticket
  };

  readonly cifra    = cifra;
  readonly hoyTexto = fechaLarga(new Date());

  // ─── Control de acceso (basado en estado real del turno) ───
  readonly verificandoCaja = signal(true);
  readonly cajaHabilitada  = signal(false);
  readonly estadoCaja      = signal<EstadoCajaCompleto['estado']>('SIN_APERTURA');
  readonly turnoCajero     = signal<any>(null);
  readonly esAdmin = this.sesion.esAdmin;

  // ─── Estado ───
  readonly mesas    = signal<any[]>([]);
  readonly cargando = signal(true);

  // ─── Modal nueva mesa ───
  readonly mostrarModalMesa = signal(false);
  readonly nuevaMesaNum     = signal('');
  readonly errorMesa        = signal('');

  // ─── Modal mesa seleccionada ───
  readonly mesaSeleccionada = signal<any>(null);

  // ─── Códigos QR ───
  private readonly CLAVE_URL_QR = 'qr_base_url_sgiv';
  readonly mostrarModalQR = signal(false);
  readonly baseUrlQR      = signal('');
  readonly generandoQR    = signal(false);
  readonly errorQR        = signal('');
  readonly codigosQR      = signal<{ id_mesa: number; numero_mesa: number; qr: string; url: string }[]>([]);

  // ─── Auto-refresh ───
  private detenerSondeo?: () => void;
  private readonly REFRESH_INTERVAL_MS = 30000; // 30 segundos
  private subs: Subscription[] = [];

  ngOnInit() {
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
    if (this.esAdmin()) {
      this.cajaHabilitada.set(true);
      this.estadoCaja.set('ABIERTA');
      this.verificandoCaja.set(false);
      this.inicializar();
      return;
    }

    this.cajaService.obtenerEstadoCompleto().subscribe({
      next: (res) => {
        this.estadoCaja.set(res.estado);
        this.cajaHabilitada.set(res.puede_vender);
        this.turnoCajero.set(res.turno);
        this.verificandoCaja.set(false);

        if (res.puede_vender) this.inicializar();
        else this.cargando.set(false);
      },
      error: () => {
        this.cajaHabilitada.set(false);
        this.estadoCaja.set('SIN_APERTURA');
        this.verificandoCaja.set(false);
        this.cargando.set(false);
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

    // Cierre automático de las 00:00
    this.subs.push(this.socketService.escuchar<any>('caja:cerrada').subscribe(d => {
      if (!this.esAdmin() && Number(d?.id_usuario) === this.sesion.usuario()?.id_usuario) this.verificarAccesoCaja();
    }));

    this.subs.push(this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      this.dialogo.avisar(`Pedido QR cargado a la Mesa ${data.numero_mesa || ''}`);
      this.cargarMesas();
    }));
  }

  // ─── CARGA DE DATOS ───
  cargarMesas() {
    const id_sucursal = this.sesion.idSucursal();
    this.cuentaService.getMesasConCuenta(id_sucursal).subscribe({
      next: (m) => { this.mesas.set(m); this.cargando.set(false); },
      error: ()  => { this.cargando.set(false); }
    });
  }

  // ─── SELECCIONAR MESA ───
  seleccionarMesa(mesa: any) { this.mesaSeleccionada.set(mesa); }
  onModalCerrado()           { this.mesaSeleccionada.set(null); }
  onMesaActualizada()        { this.cargarMesas(); }

  // ─── ESTILOS ───
  claseMesa(mesa: any): string {
    if (mesa.id_cuenta) return 'cuenta';
    return mesa.estado_mesa === 'Ocupada' ? 'ocupada' : 'libre';
  }

  readonly resumen = computed(() => {
    const mesas = this.mesas();
    const conCuenta = mesas.filter(m => m.id_cuenta);
    return {
      libres:    mesas.filter(m => this.claseMesa(m) === 'libre').length,
      conCuenta: conCuenta.length,
      porCobrar: conCuenta.reduce((s, m) => s + (Number(m.total_acumulado) || 0), 0)
    };
  });

  // ─── HABILITAR / LIBERAR (menú QR: con la mesa habilitada sus clientes piden sin verificación) ───
  readonly procesandoMesa = signal<number | null>(null);

  /** Con el QR temporal activo se imprime su ticket al habilitar (la ventana se abre con el clic) */
  habilitar(mesa: any) {
    const ventana = this.ajustes.config().menu_qr_visita ? this.abrirVentana() : null;
    if (ventana === undefined) return;
    this.accionMesa(mesa, this.mesaService.habilitar(mesa.id_mesa),
                    () => ventana && this.imprimirQRVisita(mesa, ventana), () => ventana?.close());
  }

  async liberar(mesa: any) {
    const si = await this.dialogo.confirmar({
      titulo: `¿Liberar la Mesa ${mesa.numero_mesa}?`,
      mensaje: 'Los clientes de esta mesa tendrán que volver a escanear el QR para pedir.',
      textoConfirmar: 'Liberar'
    });
    if (si) this.accionMesa(mesa, this.mesaService.liberar(mesa.id_mesa));
  }

  private accionMesa(mesa: any, accion: any, despues?: () => void, siFalla?: () => void) {
    if (this.procesandoMesa()) { siFalla?.(); return; }
    this.procesandoMesa.set(mesa.id_mesa);
    accion.subscribe({
      next: (r: any) => { this.procesandoMesa.set(null); this.dialogo.avisar(r.mensaje); this.cargarMesas(); despues?.(); },
      error: (e: any) => {
        this.procesandoMesa.set(null);
        siFalla?.();
        this.dialogo.error(e?.error?.error || 'No se pudo actualizar la mesa.');
      }
    });
  }

  /** undefined = el navegador bloqueó la ventana */
  private abrirVentana(): Window | undefined {
    const ventana = window.open('', '_blank');
    if (ventana) return ventana;
    this.dialogo.error('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.');
    return undefined;
  }

  /** Ticket con el QR que sirve solo durante esta visita */
  imprimirQRVisita(mesa: any, ventana = this.abrirVentana()) {
    if (!ventana) return;
    this.mesaService.qrVisita(mesa.id_mesa, this.baseUrlGuardada()).subscribe({
      next: (r) => this.escribirHoja(ventana, 'QR de la visita', `
        <div class="tarjeta">
          ${this.cabeceraHoja()}
          <img src="${r.qr}" alt="QR Mesa ${r.numero_mesa}">
          <p class="mesa">Mesa ${r.numero_mesa}</p>
          <p class="ayuda">Escanea para pedir durante tu visita</p>
        </div>`, 'ticket'),
      error: (e: any) => { ventana.close(); this.dialogo.error(e?.error?.error || 'No se pudo generar el QR de la visita.'); }
    });
  }

  private baseUrlGuardada(): string {
    try { return localStorage.getItem(this.CLAVE_URL_QR) || window.location.origin; } catch { return window.location.origin; }
  }

  // ─── NUEVA MESA ───
  abrirModalMesa()  { this.nuevaMesaNum.set(''); this.errorMesa.set(''); this.mostrarModalMesa.set(true); }
  cerrarModalMesa() { this.mostrarModalMesa.set(false); }

  crearMesa() {
    const numero = this.nuevaMesaNum();
    if (!numero || isNaN(+numero)) return this.errorMesa.set('Número inválido');
    const id_sucursal = this.sesion.idSucursal();
    this.mesaService.crearMesa({ id_sucursal, numero_mesa: +numero }).subscribe({
      next: () => { this.cerrarModalMesa(); this.cargarMesas(); },
      error: (e: any) => this.errorMesa.set(e?.error?.error || 'Error al crear la mesa')
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
    this.baseUrlQR.set(guardada || window.location.origin);
    this.codigosQR.set([]);
    this.errorQR.set('');
    this.mostrarModalQR.set(true);
    this.generarCodigosQR();
  }

  cerrarModalQR() { this.mostrarModalQR.set(false); }

  readonly baseUrlEsLocal = computed(() => {
    try {
      const host = new URL(this.baseUrlQR()).hostname;
      return host === 'localhost' || host.startsWith('127.') || host === '[::1]';
    } catch { return false; }
  });

  generarCodigosQR() {
    const base = this.baseUrlQR().trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(base)) {
      return this.errorQR.set('Escribe la dirección completa, por ejemplo http://192.168.1.10:4200');
    }
    this.baseUrlQR.set(base);
    try { localStorage.setItem(this.CLAVE_URL_QR, base); } catch { }

    if (!this.mesas().length) return this.codigosQR.set([]);
    this.generandoQR.set(true);
    this.errorQR.set('');
    this.mesaService.obtenerQRSucursal(this.sesion.idSucursal(), base).subscribe({
      next: (codigos) => {
        this.codigosQR.set(codigos);
        this.generandoQR.set(false);
      },
      error: (e: any) => {
        this.errorQR.set(e?.error?.error || 'No se pudieron generar los códigos.');
        this.generandoQR.set(false);
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

  private cabeceraHoja(): string {
    const nombre = this.escaparHtml(this.ajustes.nombre());
    const logo   = this.ajustes.logo() ? `<img class="logo" src="${this.ajustes.logo()}" alt="">` : '';
    return `${logo}<p class="marca">${nombre}</p>`;
  }

  /** Hoja imprimible en una ventana aparte: no arrastra el resto del sistema */
  imprimirQR() {
    const tarjetas = this.codigosQR().map(c => `
      <div class="tarjeta">
        ${this.cabeceraHoja()}
        <img src="${c.qr}" alt="QR Mesa ${c.numero_mesa}">
        <p class="mesa">Mesa ${c.numero_mesa}</p>
        <p class="ayuda">${this.ajustes.config().menu_qr_visita ? 'Escanea para ver el menú'
                                                                   : 'Escanea para ver el menú y pedir desde tu mesa'}</p>
      </div>`).join('');

    const ventana = this.abrirVentana();
    if (ventana) this.escribirHoja(ventana, 'Códigos QR de mesas', tarjetas, 'hoja');
  }

  /** hoja = varias tarjetas en A4; ticket = una sola, para la impresora de tickets */
  private escribirHoja(ventana: Window, titulo: string, contenido: string, formato: 'hoja' | 'ticket') {
    const color = `rgb(${this.ajustes.colorPrimarioRgb().join(',')})`;
    ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: ${formato === 'hoja' ? '12mm' : '2mm'}; }
        .hoja { display: grid; grid-template-columns: ${formato === 'hoja' ? 'repeat(2, 1fr)' : '1fr'}; gap: 10mm;
                ${formato === 'ticket' ? 'width: 70mm;' : ''} }
        .tarjeta { border: 2px dashed #999; border-radius: 6mm; padding: 6mm; text-align: center; break-inside: avoid; }
        .tarjeta img { width: 60mm; height: 60mm; }
        .marca { margin: 0 0 2mm; font-weight: bold; color: ${color}; }
        .tarjeta img.logo { width: auto; height: 14mm; margin-bottom: 1mm; }
        .mesa  { margin: 2mm 0 0; font-size: 22pt; font-weight: 900; }
        .ayuda { margin: 1mm 0 0; font-size: 10pt; color: #555; }
      </style></head>
      <body><div class="hoja">${contenido}</div>
      <script>window.onload = () => { window.print(); }<\/script></body></html>`);
    ventana.document.close();
  }

  private escaparHtml(texto: string): string {
    return texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }
}
