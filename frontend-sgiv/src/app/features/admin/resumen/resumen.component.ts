import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, untracked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Chart } from '../../../core/utils/graficos';
import { LucideAngularModule, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-angular';
import { ReporteService } from '../../../core/services/reporte.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { ProductoService } from '../../../core/services/producto.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { cifra, entero, variacion, porcentaje, fechaLarga, fechaCorta, fechaHora, hora, temaGrafico, opcionesBase, DIAS_SEMANA } from '../../../core/utils/informe';
import { sondeo } from '../../../core/utils/sondeo';

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, SelectorSucursalComponent],
  templateUrl: './resumen.component.html',
  styleUrls: ['../../shared/informe/informe.css', './resumen.component.css']
})
export class ResumenComponent implements OnInit, OnDestroy {
  private reporteService  = inject(ReporteService);
  private sucursalService = inject(SucursalService);
  private productoService = inject(ProductoService);
  private ajustes         = inject(AjustesService);
  private cdr             = inject(ChangeDetectorRef);
  readonly moneda         = this.ajustes.moneda;

  @ViewChild('graficoHoras') graficoHorasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoDias')  graficoDiasRef?:  ElementRef<HTMLCanvasElement>;

  readonly icons = { sube: ArrowUpRight, baja: ArrowDownRight, igual: Minus };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly porcentaje = porcentaje;

  cargando    = true;
  refrescando = false;
  esAdmin     = false;
  datos: any  = null;
  actualizado: Date | null = null;
  readonly hoyTexto = fechaLarga(new Date());

  sucursales: any[] = [];
  sucursalActual: number | null = 1;   // null = todas
  private cajasCache: { clave: any[]; valor: Record<number, boolean> } = { clave: [], valor: {} };

  /** Sucursal → caja abierta (para los puntos del selector); se recalcula solo si cambian los datos */
  get cajasAbiertas(): Record<number, boolean> {
    const abiertas = this.datos?.cajas_abiertas;
    if (this.cajasCache.clave[0] !== abiertas || this.cajasCache.clave[1] !== this.sucursales) {
      const valor = Object.fromEntries(this.sucursales.map(s => [s.id_sucursal, !!abiertas?.includes(s.id_sucursal)]));
      this.cajasCache = { clave: [abiertas, this.sucursales], valor };
    }
    return this.cajasCache.valor;
  }

  categorias: any[] = [];
  categoriaFiltro: number | null = null;

  private graficos: Chart[] = [];
  private detenerSondeo?: () => void;

  constructor() {
    // Redibuja los gráficos al cambiar color o modo oscuro en Ajustes
    effect(() => {
      this.ajustes.oscuro();
      this.ajustes.config();
      untracked(() => this.renderizarGraficos());
    });
  }

  ngOnInit() {
    try {
      const u = JSON.parse(localStorage.getItem('usuario_sgiv') || 'null');
      this.esAdmin        = u?.id_rol === 1;
      this.sucursalActual = u?.id_sucursal || 1;
    } catch { }

    this.sucursalService.listarSucursales().subscribe({
      next: (s: any[]) => { this.sucursales = s || []; this.cdr.detectChanges(); }
    });
    this.productoService.obtenerCategorias().subscribe({
      next: (c) => { this.categorias = c || []; this.cdr.detectChanges(); }
    });
    this.cargarDatos();
    this.detenerSondeo = sondeo(() => this.cargarDatos(true), 30000);
  }

  ngOnDestroy() {
    this.detenerSondeo?.();
    this.destruirGraficos();
  }

  cargarDatos(silencioso = false) {
    if (silencioso && this.datos) this.refrescando = true;
    this.reporteService.obtenerDashboardCompleto(this.sucursalActual ?? 0, this.categoriaFiltro).subscribe({
      next: (d) => {
        this.datos = d;
        this.cargando = this.refrescando = false;
        this.actualizado = new Date();
        this.cdr.detectChanges();
        setTimeout(() => this.renderizarGraficos());
      },
      error: () => { this.cargando = this.refrescando = false; this.cdr.detectChanges(); }
    });
  }

  cambiarSucursal(id: number | null) {
    this.sucursalActual = id;
    this.cargando = true;
    this.destruirGraficos();
    this.cargarDatos();
  }

  filtrarCategoria(id: number | null) {
    this.categoriaFiltro = id;
    this.cargarDatos(true);
  }

  // ─── Datos derivados ───
  get hoy()    { return this.datos?.hoy || {}; }
  get comp()   { return this.datos?.comparativo || {}; }
  get todas()  { return this.sucursalActual === null; }

  get vsAyer()    { return variacion(this.hoy.ingresos, this.comp.ayer_misma_hora?.ingresos); }
  get vsSemana()  { return variacion(this.hoy.ingresos, this.comp.semana_pasada_misma_hora?.ingresos); }
  get diaSemanaPasada(): string {
    return DIAS_SEMANA[(new Date().getDay() + 6) % 7].toLowerCase();
  }

  get totalMetodos(): number {
    return (this.datos?.metodos_pago || []).reduce((s: number, m: any) => s + m.ingresos, 0);
  }

  get alertasStock(): number {
    return (this.datos?.stock?.agotados || 0) + (this.datos?.stock?.bajos || 0);
  }

  get efectivoEsperado(): number {
    return (this.datos?.turnos_abiertos || []).reduce((s: number, t: any) => s + t.monto_inicial + t.efectivo, 0);
  }

  get maxProducto(): number {
    return Math.max(1, ...(this.datos?.top_productos || []).map((p: any) => p.unidades));
  }

  get totalSucursales(): number {
    return (this.datos?.sucursales || []).reduce((s: number, x: any) => s + x.ingresos, 0);
  }

  /** Últimos 7 días contra los 7 anteriores */
  get semanas() {
    const d = this.datos?.ultimos_dias || [];
    const suma = (a: any[]) => a.reduce((s, x) => s + x.ingresos, 0);
    const actual = suma(d.slice(7)), previa = suma(d.slice(0, 7));
    return { actual, previa, delta: variacion(actual, previa) };
  }

  /** "desde 17:36", o con fecha si el turno se abrió otro día */
  desde(f: string): string {
    const d = new Date(f);
    return d.toDateString() === new Date().toDateString() ? hora(d) : fechaHora(f);
  }

  colorMetodo(i: number): string {
    return temaGrafico(this.ajustes).serie[i % 6];
  }

  claseDelta(v: number | null): string {
    if (v === null || Math.abs(v) < 0.5) return 'igual';
    return v > 0 ? 'sube' : 'baja';
  }

  iconoDelta(v: number | null) {
    const c = this.claseDelta(v);
    return c === 'sube' ? this.icons.sube : c === 'baja' ? this.icons.baja : this.icons.igual;
  }

  textoDelta(v: number | null): string {
    if (v === null) return 'sin base';
    return `${Math.abs(v).toFixed(1)} %`;
  }

  // ─── Gráficos ───
  private destruirGraficos() {
    this.graficos.forEach(g => g.destroy());
    this.graficos = [];
  }

  private renderizarGraficos() {
    if (!this.datos) return;
    this.destruirGraficos();
    const t = temaGrafico(this.ajustes);
    const fmt = (v: number) => cifra(v, 0);

    const lienzoHoras = this.graficoHorasRef?.nativeElement;
    if (lienzoHoras) {
      const hoy  = new Map<number, number>(this.datos.por_hora.map((h: any) => [h.hora, h.ingresos]));
      const prom = new Map<number, number>(this.datos.por_hora_promedio.map((h: any) => [h.hora, h.ingresos]));
      const horas = [...hoy.keys(), ...prom.keys()];
      const desde = Math.min(7, ...horas), hasta = Math.max(21, ...horas);
      const etiquetas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
      const ahora = new Date().getHours();
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => `${String(i[0].label).padStart(2, '0')}:00 – ${String(+i[0].label + 1).padStart(2, '0')}:00`,
        label: (i: any) => `${i.datasetIndex ? 'Promedio 7 días' : 'Hoy'}: ${this.moneda()} ${cifra(i.raw)}`
      };
      base.scales.x.ticks.callback = function (this: any, v: any) { return `${this.getLabelForValue(v)}h`; };
      this.graficos.push(new Chart(lienzoHoras, {
        type: 'bar',
        data: {
          labels: etiquetas,
          datasets: [
            {
              data: etiquetas.map(h => hoy.get(h) || 0),
              backgroundColor: etiquetas.map(h => h === ahora ? t.acento : t.acentoMedio),
              borderRadius: 3, barPercentage: 0.7, categoryPercentage: 0.9, order: 2
            },
            {
              type: 'line', data: etiquetas.map(h => prom.get(h) || 0),
              borderColor: t.texto, borderWidth: 1.5, borderDash: [4, 4],
              pointRadius: 0, tension: 0.35, order: 1
            } as any
          ]
        },
        options: base
      }));
    }

    const lienzoDias = this.graficoDiasRef?.nativeElement;
    if (lienzoDias && this.datos.ultimos_dias?.length) {
      const dias = this.datos.ultimos_dias;
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => fechaLarga(dias[i[0].dataIndex].fecha),
        label: (i: any) => `${this.moneda()} ${cifra(i.raw)} · ${dias[i.dataIndex].ventas} ventas`
      };
      this.graficos.push(new Chart(lienzoDias, {
        type: 'bar',
        data: {
          labels: dias.map((d: any) => fechaCorta(d.fecha)),
          datasets: [{
            data: dias.map((d: any) => d.ingresos),
            backgroundColor: dias.map((_: any, i: number) => i === dias.length - 1 ? t.acento : i >= 7 ? t.acentoMedio : t.fantasma),
            borderRadius: 3, barPercentage: 0.75
          }]
        },
        options: base
      }));
    }
  }
}
