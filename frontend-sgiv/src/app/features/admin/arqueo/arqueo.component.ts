import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, RotateCw, ChevronDown, ChevronRight, X } from 'lucide-angular';
import { CajaService } from '../../../core/services/caja.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { cifra, entero, porcentaje, fechaLarga, fechaHora, hora, temaGrafico } from '../../../core/utils/informe';

// Billetes y monedas en circulación (boliviano)
const DENOMINACIONES = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

@Component({
  selector: 'app-arqueo',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './arqueo.component.html',
  styleUrls: ['../../shared/informe/informe.css', './arqueo.component.css']
})
export class ArqueoComponent implements OnInit {
  private cajaService = inject(CajaService);
  private ajustes     = inject(AjustesService);
  readonly moneda     = this.ajustes.moneda;

  readonly icons = { actualizar: RotateCw, abajo: ChevronDown, derecha: ChevronRight, cerrar: X };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly fechaHora = fechaHora;
  readonly porcentaje = porcentaje;
  readonly hoyTexto = fechaLarga(new Date());
  readonly denominaciones = DENOMINACIONES;

  readonly cargando = signal(true);
  readonly cerrando = signal(false);
  readonly error    = signal('');
  readonly mostrarConfirmCierre = signal(false);

  usuarioActual: any = null;
  esAdmin = false;
  readonly arqueo = signal<any>({ resumen: {}, ventas: [], turno_activo: null, turno_resumen: null });

  readonly efectivoContado = signal<number | null>(null);
  readonly mostrarConteo   = signal(false);
  // Conteo por denominación: se reemplaza con set(); el template edita el objeto actual
  readonly conteo = signal<Record<number, number | null>>({});

  ngOnInit() {
    try { this.usuarioActual = JSON.parse(localStorage.getItem('usuario_sgiv') || 'null'); } catch { }
    this.esAdmin = this.usuarioActual?.id_rol === 1;
    this.cargarArqueo();
  }

  cargarArqueo() {
    const a = this.arqueo();
    this.cargando.set(!a.turno_activo && !a.ventas?.length);
    this.cajaService.obtenerArqueo(this.usuarioActual?.id_sucursal || 1).subscribe({
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

  readonly metodosHoy = computed(() => {
    const m = new Map<string, { metodo: string; ventas: number; total: number }>();
    for (const v of this.arqueo().ventas || []) {
      const x = m.get(v.metodo_pago) || { metodo: v.metodo_pago, ventas: 0, total: 0 };
      x.ventas++; x.total += Number(v.monto_total_venta);
      m.set(v.metodo_pago, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  });

  colorSerie(i: number): string { return temaGrafico(this.ajustes).serie[i % 6]; }

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
    this.cajaService.cerrarCaja({ id_sucursal: this.usuarioActual?.id_sucursal || 1, efectivo_contado: contado }).subscribe({
      next: () => {
        this.cerrando.set(false);
        this.mostrarConfirmCierre.set(false);
        this.efectivoContado.set(null);
        this.conteo.set({});
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = false;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }
        this.cargarArqueo();
      },
      error: (e) => {
        this.cerrando.set(false);
        this.error.set(e?.error?.error || 'No se pudo cerrar la caja.');
        this.mostrarConfirmCierre.set(false);
      }
    });
  }
}
