import { Component, computed, inject, Injector, OnInit, OnDestroy, afterNextRender, effect, signal, untracked, ElementRef, ViewChild } from '@angular/core';
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
import { SesionService } from '../../../core/services/sesion.service';

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, SelectorSucursalComponent],
  templateUrl: './resumen.component.html',
  styleUrls: ['../../shared/informe/informe.css', './resumen.component.css']
})
export class ResumenComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private reporteService  = inject(ReporteService);
  private sucursalService = inject(SucursalService);
  private productoService = inject(ProductoService);
  private ajustes         = inject(AjustesService);
  private injector        = inject(Injector);
  readonly moneda         = this.ajustes.moneda;

  @ViewChild('graficoHoras') graficoHorasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoDias')  graficoDiasRef?:  ElementRef<HTMLCanvasElement>;

  readonly icons = { sube: ArrowUpRight, baja: ArrowDownRight, igual: Minus };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly porcentaje = porcentaje;

  readonly cargando    = signal(true);
  readonly refrescando = signal(false);
  readonly esAdmin = this.sesion.esAdmin;
  readonly datos       = signal<any>(null);
  readonly actualizado = signal<Date | null>(null);
  readonly hoyTexto = fechaLarga(new Date());

  readonly sucursales     = signal<any[]>([]);
  readonly sucursalActual = signal<number | null>(1);   // null = todas

  /** Sucursal → caja abierta (para los puntos del selector) */
  readonly cajasAbiertas = computed(() => {
    const abiertas = this.datos()?.cajas_abiertas;
    return Object.fromEntries(this.sucursales().map(s => [s.id_sucursal, !!abiertas?.includes(s.id_sucursal)])) as Record<number, boolean>;
  });

  readonly categorias      = signal<any[]>([]);
  readonly categoriaFiltro = signal<number | null>(null);

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
    this.sucursalActual.set(this.sesion.idSucursal());

    this.sucursalService.listarSucursales().subscribe({
      next: (s: any[]) => this.sucursales.set(s || [])
    });
    this.productoService.obtenerCategorias().subscribe({
      next: (c) => this.categorias.set(c || [])
    });
    this.cargarDatos();
    this.detenerSondeo = sondeo(() => this.cargarDatos(true), 30000);
  }

  ngOnDestroy() {
    this.detenerSondeo?.();
    this.destruirGraficos();
  }

  cargarDatos(silencioso = false) {
    if (silencioso && this.datos()) this.refrescando.set(true);
    this.reporteService.obtenerDashboardCompleto(this.sucursalActual() ?? 0, this.categoriaFiltro()).subscribe({
      next: (d) => {
        this.datos.set(d);
        this.cargando.set(false);
        this.refrescando.set(false);
        this.actualizado.set(new Date());
        afterNextRender(() => this.renderizarGraficos(), { injector: this.injector });
      },
      error: () => { this.cargando.set(false); this.refrescando.set(false); }
    });
  }

  cambiarSucursal(id: number | null) {
    this.sucursalActual.set(id);
    this.cargando.set(true);
    this.destruirGraficos();
    this.cargarDatos();
  }

  filtrarCategoria(id: number | null) {
    this.categoriaFiltro.set(id);
    this.cargarDatos(true);
  }

  // ─── Datos derivados ───
  readonly hoy   = computed(() => this.datos()?.hoy || {});
  readonly comp  = computed(() => this.datos()?.comparativo || {});
  readonly todas = computed(() => this.sucursalActual() === null);

  readonly vsAyer   = computed(() => variacion(this.hoy().ingresos, this.comp().ayer_misma_hora?.ingresos));
  readonly vsSemana = computed(() => variacion(this.hoy().ingresos, this.comp().semana_pasada_misma_hora?.ingresos));
  get diaSemanaPasada(): string {
    return DIAS_SEMANA[(new Date().getDay() + 6) % 7].toLowerCase();
  }

  readonly totalMetodos = computed(() =>
    (this.datos()?.metodos_pago || []).reduce((s: number, m: any) => s + m.ingresos, 0));

  readonly alertasStock = computed(() =>
    (this.datos()?.stock?.agotados || 0) + (this.datos()?.stock?.bajos || 0));

  readonly efectivoEsperado = computed(() =>
    (this.datos()?.turnos_abiertos || []).reduce((s: number, t: any) => s + t.monto_inicial + t.efectivo, 0));

  readonly maxProducto = computed(() =>
    Math.max(1, ...(this.datos()?.top_productos || []).map((p: any) => p.unidades)));

  readonly totalSucursales = computed(() =>
    (this.datos()?.sucursales || []).reduce((s: number, x: any) => s + x.ingresos, 0));

  /** Últimos 7 días contra los 7 anteriores */
  readonly semanas = computed(() => {
    const d = this.datos()?.ultimos_dias || [];
    const suma = (a: any[]) => a.reduce((s, x) => s + x.ingresos, 0);
    const actual = suma(d.slice(7)), previa = suma(d.slice(0, 7));
    return { actual, previa, delta: variacion(actual, previa) };
  });

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
    const datos = this.datos();
    if (!datos) return;
    this.destruirGraficos();
    const t = temaGrafico(this.ajustes);
    const fmt = (v: number) => cifra(v, 0);

    const lienzoHoras = this.graficoHorasRef?.nativeElement;
    if (lienzoHoras) {
      const hoy  = new Map<number, number>(datos.por_hora.map((h: any) => [h.hora, h.ingresos]));
      const prom = new Map<number, number>(datos.por_hora_promedio.map((h: any) => [h.hora, h.ingresos]));
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
    if (lienzoDias && datos.ultimos_dias?.length) {
      const dias = datos.ultimos_dias;
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
