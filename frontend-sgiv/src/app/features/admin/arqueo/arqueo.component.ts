import { Component, computed, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, RotateCw, ChevronDown, ChevronRight, X, Printer, Banknote, QrCode, Wallet } from 'lucide-angular';
import { METODO_PAGO } from '../../../core/utils/metodos-pago';
import { CajaService } from '../../../core/services/caja.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { cifra, entero, fechaLarga, fechaHora, hora } from '../../../core/utils/informe';
import { SesionService } from '../../../core/services/sesion.service';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { DatosTicket, TicketComponent } from '../../shared/ticket/ticket.component';
import { ImpresionService } from '../../../core/services/impresion.service';
import { DialogoService } from '../../../core/services/dialogo.service';

// Billetes y monedas en circulación (boliviano)
const DENOMINACIONES = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

@Component({
  selector: 'app-arqueo',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, TicketComponent],
  templateUrl: './arqueo.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css', './arqueo.component.css']
})
export class ArqueoComponent implements OnInit {
  private readonly sesion = inject(SesionService);
  private cajaService = inject(CajaService);
  readonly ajustes    = inject(AjustesService);
  private impresion   = inject(ImpresionService);
  private dialogo     = inject(DialogoService);
  readonly moneda     = this.ajustes.moneda;

  readonly icons = { actualizar: RotateCw, abajo: ChevronDown, derecha: ChevronRight, cerrar: X, imprimir: Printer,
                     efectivo: Banknote, qr: QrCode, total: Wallet };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly fechaHora = fechaHora;
  readonly hoyTexto = fechaLarga(new Date());
  readonly denominaciones = DENOMINACIONES;

  readonly cargando = signal(true);
  readonly cerrando = signal(false);
  readonly error    = signal('');
  readonly mostrarConfirmCierre = signal(false);

  // ─── Reimpresión de comprobantes ───
  readonly comprobante      = signal<DatosTicket | null>(null);
  readonly fechaComprobante = signal(new Date());
  readonly buscandoVenta    = signal<number | null>(null);
  @ViewChild('zonaComprobante') zonaComprobante?: ElementRef<HTMLElement>;

  readonly esAdmin = this.sesion.esAdmin;
  readonly arqueo = signal<any>({ resumen: {}, ventas: [], turno_activo: null, turno_resumen: null });

  readonly efectivoContado = signal<number | null>(null);
  readonly mostrarConteo   = signal(false);
  // Conteo por denominación: se reemplaza con set(); el template edita el objeto actual
  readonly conteo = signal<Record<number, number | null>>({});

  ngOnInit() {
    this.cargarArqueo();
  }

  cargarArqueo() {
    const a = this.arqueo();
    this.cargando.set(!a.turno_activo && !a.ventas?.length);
    this.cajaService.obtenerArqueo(this.sesion.idSucursal()).subscribe({
      next: (data) => { this.arqueo.set(data); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.error.set('No se pudo cargar el arqueo.'); }
    });
  }

  // ─── Estado ───
  readonly turno   = computed(() => this.arqueo().turno_activo);
  readonly tr      = computed(() => this.arqueo().turno_resumen || { metodos: [], ventas: 0, total: 0, efectivo: 0, efectivo_esperado: 0 });
  readonly abierto = computed(() => this.turno()?.estado_turno === 'Abierto');
  readonly cerrado = computed(() => this.turno()?.estado_turno === 'Cerrado');
  readonly hoy     = computed(() => this.arqueo().resumen || {});

  /** Abierto otro día: se muestra la fecha completa */
  desde(f: string): string {
    return new Date(f).toDateString() === new Date().toDateString() ? hora(f) : fechaHora(f);
  }

  /** Cobrado por QR en el turno */
  readonly cobradoQr = computed(() =>
    Number(this.tr().metodos.find((m: any) => m.metodo_pago === METODO_PAGO.qr)?.total) || 0);

  // ─── Conteo de efectivo ───
  readonly conBilletes = computed(() => /^bs/i.test(this.moneda().trim()));

  get totalConteo(): number {
    const conteo = this.conteo();
    return +DENOMINACIONES.reduce((s, d) => s + d * (Number(conteo[d]) || 0), 0).toFixed(2);
  }

  actualizarConteo() {
    this.efectivoContado.set(this.totalConteo);
  }

  readonly diferencia = computed(() => {
    const contado = this.efectivoContado() as any;
    if (contado === null || contado === undefined || contado === '') return null;
    return +(Number(contado) - this.tr().efectivo_esperado).toFixed(2);
  });

  textoDiferencia(d: number | null): string {
    if (d === null) return '';
    if (Math.abs(d) < 0.005) return 'La caja cuadra';
    return d < 0 ? `Faltan ${this.moneda()} ${cifra(-d)}` : `Sobran ${this.moneda()} ${cifra(d)}`;
  }

  claseDiferencia(d: number | null): string {
    if (d === null) return 'neutro';
    return Math.abs(d) < 0.005 ? 'ok' : d < 0 ? 'mal' : 'aviso';
  }

  // ─── Cierre ───
  confirmarCierre() {
    this.error.set('');
    const contado = this.efectivoContado();
    if (contado !== null && (Number(contado) < 0 || Number.isNaN(Number(contado))))
      return this.error.set('El efectivo contado no es válido.');
    this.mostrarConfirmCierre.set(true);
  }

  ejecutarCierreCaja() {
    this.cerrando.set(true);
    const contado = this.diferencia() === null ? null : Number(this.efectivoContado());
    this.cajaService.cerrarCaja({ id_sucursal: this.sesion.idSucursal(), efectivo_contado: contado }).subscribe({
      next: () => {
        this.cerrando.set(false);
        this.mostrarConfirmCierre.set(false);
        this.efectivoContado.set(null);
        this.conteo.set({});
        this.cargarArqueo();
      },
      error: (e) => {
        this.cerrando.set(false);
        this.error.set(e?.error?.error || 'No se pudo cerrar la caja.');
        this.mostrarConfirmCierre.set(false);
      }
    });
  }

  reimprimir(id_venta: number) {
    if (this.buscandoVenta()) return;
    this.buscandoVenta.set(id_venta);
    this.cajaService.obtenerComprobante(id_venta).subscribe({
      next: (c) => {
        this.buscandoVenta.set(null);
        this.fechaComprobante.set(new Date(c.fecha_venta));
        this.comprobante.set({ ...c, reimpreso: new Date() });
      },
      error: (e) => {
        this.buscandoVenta.set(null);
        this.dialogo.error(e?.error?.error || 'No se pudo obtener el comprobante.');
      }
    });
  }

  imprimirComprobante() {
    this.impresion.imprimirTicket(this.zonaComprobante?.nativeElement, this.ajustes.config().ticket_ancho);
    this.comprobante.set(null);
  }
}
