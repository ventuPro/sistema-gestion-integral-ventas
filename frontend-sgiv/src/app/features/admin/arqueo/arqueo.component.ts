import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
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
  private cdr         = inject(ChangeDetectorRef);
  readonly moneda     = this.ajustes.moneda;

  readonly icons = { actualizar: RotateCw, abajo: ChevronDown, derecha: ChevronRight, cerrar: X };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly fechaHora = fechaHora;
  readonly porcentaje = porcentaje;
  readonly hoyTexto = fechaLarga(new Date());
  readonly denominaciones = DENOMINACIONES;

  cargando = true;
  cerrando = false;
  error    = '';
  mostrarConfirmCierre = false;

  usuarioActual: any = null;
  esAdmin = false;
  arqueo: any = { resumen: {}, ventas: [], turno_activo: null, turno_resumen: null };

  efectivoContado: number | null = null;
  mostrarConteo = false;
  conteo: Record<number, number | null> = {};

  ngOnInit() {
    try { this.usuarioActual = JSON.parse(localStorage.getItem('usuario_sgiv') || 'null'); } catch { }
    this.esAdmin = this.usuarioActual?.id_rol === 1;
    this.cargarArqueo();
  }

  cargarArqueo() {
    this.cargando = !this.arqueo.turno_activo && !this.arqueo.ventas?.length;
    this.cajaService.obtenerArqueo(this.usuarioActual?.id_sucursal || 1).subscribe({
      next: (data) => { this.arqueo = data; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.error = 'No se pudo cargar el arqueo.'; this.cdr.detectChanges(); }
    });
  }

  // ─── Estado ───
  get turno()   { return this.arqueo.turno_activo; }
  get tr()      { return this.arqueo.turno_resumen || { metodos: [], ventas: 0, total: 0, efectivo: 0, efectivo_esperado: 0 }; }
  get abierto() { return this.turno?.estado_turno === 'Abierto'; }
  get cerrado() { return this.turno?.estado_turno === 'Cerrado'; }
  get hoy()     { return this.arqueo.resumen || {}; }

  /** Abierto otro día: se muestra la fecha completa */
  desde(f: string): string {
    return new Date(f).toDateString() === new Date().toDateString() ? hora(f) : fechaHora(f);
  }

  get metodosHoy(): { metodo: string; ventas: number; total: number }[] {
    const m = new Map<string, { metodo: string; ventas: number; total: number }>();
    for (const v of this.arqueo.ventas || []) {
      const x = m.get(v.metodo_pago) || { metodo: v.metodo_pago, ventas: 0, total: 0 };
      x.ventas++; x.total += Number(v.monto_total_venta);
      m.set(v.metodo_pago, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }

  colorSerie(i: number): string { return temaGrafico(this.ajustes).serie[i % 6]; }

  // ─── Conteo de efectivo ───
  get conBilletes(): boolean { return /^bs/i.test(this.moneda().trim()); }

  get totalConteo(): number {
    return +DENOMINACIONES.reduce((s, d) => s + d * (Number(this.conteo[d]) || 0), 0).toFixed(2);
  }

  actualizarConteo() {
    this.efectivoContado = this.totalConteo;
  }

  get diferencia(): number | null {
    if (this.efectivoContado === null || this.efectivoContado === undefined || (this.efectivoContado as any) === '') return null;
    return +(Number(this.efectivoContado) - this.tr.efectivo_esperado).toFixed(2);
  }

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
    this.error = '';
    if (this.efectivoContado !== null && (Number(this.efectivoContado) < 0 || Number.isNaN(Number(this.efectivoContado)))) {
      this.error = 'El efectivo contado no es válido.'; return;
    }
    this.mostrarConfirmCierre = true;
  }

  ejecutarCierreCaja() {
    this.cerrando = true;
    const contado = this.diferencia === null ? null : Number(this.efectivoContado);
    this.cajaService.cerrarCaja({ id_sucursal: this.usuarioActual?.id_sucursal || 1, efectivo_contado: contado }).subscribe({
      next: () => {
        this.cerrando = false;
        this.mostrarConfirmCierre = false;
        this.efectivoContado = null;
        this.conteo = {};
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = false;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }
        this.cargarArqueo();
      },
      error: (e) => {
        this.cerrando = false;
        this.error = e?.error?.error || 'No se pudo cerrar la caja.';
        this.mostrarConfirmCierre = false;
        this.cdr.detectChanges();
      }
    });
  }
}
