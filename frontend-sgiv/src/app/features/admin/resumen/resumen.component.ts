import { Component, computed, inject, Injector, OnInit, OnDestroy, afterNextRender, effect, signal, untracked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Chart } from '../../../core/utils/graficos';
import { ReporteService } from '../../../core/services/reporte.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { ProductoService } from '../../../core/services/producto.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { PizzaComponent, ParteGrafico } from '../../shared/informe/pizza.component';
import { RankingComponent, FilaRanking } from '../../shared/informe/ranking.component';
import { cifra, entero, porcentaje, variacion, fechaHora, fechaDia, hora, temaGrafico, opcionesBase } from '../../../core/utils/informe';
import { colorCategoria, colorMetodo, coloresSignificado, indiceCategorias } from '../../../core/utils/colores';
import { METODO_PAGO } from '../../../core/utils/metodos-pago';
import { sondeo } from '../../../core/utils/sondeo';
import { SesionService } from '../../../core/services/sesion.service';
import { PermisoService } from '../../../core/services/permiso.service';

type Metrica = 'ingresos' | 'ventas';

// ─── Panel del día: frase resumen, ticket del día y un gráfico por pregunta (cada uno con su cifra) ───
@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, RouterLink, SelectorSucursalComponent, PizzaComponent, RankingComponent],
  templateUrl: './resumen.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/informe/bloques.css', './resumen.component.css']
})
export class ResumenComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private reporteService  = inject(ReporteService);
  private sucursalService = inject(SucursalService);
  private productoService = inject(ProductoService);
  readonly ajustes        = inject(AjustesService);
  private injector        = inject(Injector);
  private permisos        = inject(PermisoService);
  readonly moneda         = this.ajustes.moneda;

  @ViewChild('graficoHoras') graficoHorasRef?: ElementRef<HTMLCanvasElement>;

  readonly cifra = cifra;
  readonly entero = entero;
  readonly hora = hora;
  readonly porcentaje = porcentaje;
  readonly abs = Math.abs;
  readonly metodo = METODO_PAGO;

  readonly cargando    = signal(true);
  readonly refrescando = signal(false);
  readonly esAdmin = this.sesion.esAdmin;
  readonly datos       = signal<any>(null);
  readonly actualizado = signal<Date | null>(null);

  readonly sucursales     = signal<any[]>([]);
  readonly sucursalActual = signal<number | null>(1);   // null = todas

  /** Sucursal → caja abierta (para los puntos del selector) */
  readonly cajasAbiertas = computed(() => {
    const abiertas = this.datos()?.cajas_abiertas;
    return Object.fromEntries(this.sucursales().map(s => [s.id_sucursal, !!abiertas?.includes(s.id_sucursal)])) as Record<number, boolean>;
  });

  readonly categorias      = signal<any[]>([]);
  readonly categoriaFiltro = signal<number | null>(null);

  // Filtros de cada gráfico
  readonly metricaHoras     = signal<Metrica>('ingresos');
  readonly metricaTop       = signal<'unidades' | 'ingresos'>('ingresos');
  readonly metricaSucursal  = signal<Metrica>('ingresos');

  private graficos: Chart[] = [];
  private detenerSondeo?: () => void;

  readonly enBs     = (v: number) => `${this.moneda()} ${cifra(v)}`;
  readonly enEntero = (v: number) => entero(v);

  constructor() {
    // Redibuja el gráfico de horas al cambiar el color, el modo oscuro o la métrica
    effect(() => {
      this.ajustes.oscuro();
      this.ajustes.config();
      this.metricaHoras();
      untracked(() => this.renderizarGraficos());
    });
  }

  ngOnInit() {
    this.sucursalActual.set(this.sesion.idSucursal());
    this.sucursalService.listarSucursales().subscribe({ next: (s: any[]) => this.sucursales.set(s || []) });
    this.productoService.obtenerCategorias().subscribe({ next: (c) => this.categorias.set(c || []) });
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
        this.actualizado.set(new Date());
        this.cargando.set(false);
        this.refrescando.set(false);
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

  filtrarCategoria(valor: string) {
    this.categoriaFiltro.set(Number(valor) || null);
    this.cargarDatos(true);
  }

  // ─── Datos derivados ───
  readonly hoy   = computed(() => this.datos()?.hoy || {});
  readonly comp  = computed(() => this.datos()?.comparativo || {});
  readonly todas = computed(() => this.sucursalActual() === null);
  readonly fechaHoy = fechaDia(new Date());
  readonly nombreSucursal = computed(() => this.todas() ? 'Todas las sucursales'
    : this.sucursales().find(s => s.id_sucursal === this.sucursalActual())?.nombre_sucursal ?? '');

  /** Variación frente a ayer a la misma hora (null = ayer no hubo ventas a esta hora) */
  readonly variacionAyer = computed(() => variacion(this.hoy().ingresos, this.comp().ayer_misma_hora?.ingresos));

  readonly cobradoHoy = computed(() => {
    const metodos: any[] = this.datos()?.metodos_pago || [];
    const de = (m: string) => metodos.find(x => x.metodo_pago === m)?.ingresos || 0;
    return { efectivo: de(METODO_PAGO.efectivo), qr: de(METODO_PAGO.qr) };
  });

  readonly efectivoEsperado = computed(() =>
    (this.datos()?.turnos_abiertos || []).reduce((s: number, t: any) => s + t.monto_inicial + t.efectivo, 0));

  readonly costoHoy = computed(() => this.datos()?.costo_hoy ?? null);
  readonly vencimientos = computed(() => this.datos()?.vencimientos || { vencidos: 0, por_vencer: 0 });

  // G2 · cobros por método
  readonly partesMetodos = computed<ParteGrafico[]>(() => {
    const oscuro = this.ajustes.oscuro();
    return (this.datos()?.metodos_pago || []).map((m: any) => ({ nombre: m.metodo_pago, valor: m.ingresos, color: colorMetodo(m.metodo_pago, oscuro) }));
  });
  readonly partEfectivo = computed(() => porcentaje(this.cobradoHoy().efectivo, this.partesMetodos().reduce((s, p) => s + p.valor, 0)));

  // G4 · por categoría: las 5 primeras y el resto en «Otras» (cada categoría con su color fijo)
  readonly partesCategorias = computed<ParteGrafico[]>(() => {
    const oscuro = this.ajustes.oscuro();
    const indice = indiceCategorias(this.categorias());
    const lista: any[] = this.datos()?.categorias_hoy || [];
    const partes = lista.slice(0, 5).map(c => ({ nombre: c.nombre_categoria, valor: c.ingresos, color: colorCategoria(indice.get(c.id_categoria) ?? -1, oscuro) }));
    const resto = lista.slice(5).reduce((s, c) => s + c.ingresos, 0);
    if (resto > 0) partes.push({ nombre: 'Otras', valor: resto, color: colorCategoria(-1, oscuro) });
    return partes;
  });
  readonly categoriaPrincipal = computed(() => {
    const p = this.partesCategorias(), t = p.reduce((s, x) => s + x.valor, 0);
    return p.length ? { nombre: p[0].nombre, porcentaje: porcentaje(p[0].valor, t) } : null;
  });

  // G3 · lo más vendido
  readonly filasTop = computed<FilaRanking[]>(() => (this.datos()?.top_productos || [])
    .map((p: any) => ({ nombre: p.nombre_producto, sub: p.nombre_categoria, valor: this.metricaTop() === 'unidades' ? p.unidades : p.ingresos,
                        detalle: this.metricaTop() === 'unidades' ? `${this.moneda()} ${cifra(p.ingresos)}` : `${entero(p.unidades)} u` }))
    .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor));
  readonly masVendido = computed(() => (this.datos()?.top_productos || [])[0] ?? null);

  // G5 · sucursales
  readonly filasSucursales = computed<FilaRanking[]>(() => {
    const oscuro = this.ajustes.oscuro();
    // El color sigue a la sucursal (su lugar en la lista), no a su puesto en el ranking
    const lugar = new Map(this.sucursales().map((s, i) => [s.id_sucursal, i]));
    return (this.datos()?.sucursales || [])
      .map((s: any) => ({ nombre: s.nombre_sucursal, valor: s[this.metricaSucursal()],
                          sub: s.caja_abierta ? 'Caja abierta' : 'Caja cerrada', color: colorCategoria(lugar.get(s.id_sucursal) ?? -1, oscuro) }))
      .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor);
  });
  readonly sucursalPrincipal = computed(() => {
    const l: any[] = this.datos()?.sucursales || [], t = l.reduce((s, x) => s + x.ingresos, 0);
    const p = [...l].sort((a, b) => b.ingresos - a.ingresos)[0];
    return p && t ? { nombre: p.nombre_sucursal, porcentaje: porcentaje(p.ingresos, t) } : null;
  });

  // ─── Encargos ───
  readonly fechaISO = new Date().toLocaleDateString('en-CA');
  readonly desdeDia = (f: string) => fechaDia(f).slice(0, 5);
  puedeVerEncargos() { return this.sesion.esAdmin() || this.permisos.tienePermiso('encargos'); }
  resumenEncargo(e: any): string { return (e.items || []).map((i: any) => `${i.cantidad} ${i.descripcion}`).join(', '); }

  /** "desde 17:36", o con fecha si el turno se abrió otro día */
  desde(f: string): string {
    const d = new Date(f);
    return d.toDateString() === new Date().toDateString() ? hora(d) : fechaHora(f);
  }

  // ─── G1 · ventas por hora: hoy en barras y un día normal (promedio de 7 días) en línea ───
  private destruirGraficos() {
    this.graficos.forEach(g => g.destroy());
    this.graficos = [];
  }

  private renderizarGraficos() {
    const datos = this.datos();
    if (!datos) return;
    this.destruirGraficos();
    const t = temaGrafico(this.ajustes);
    const metrica = this.metricaHoras();
    const fmt = (v: number) => metrica === 'ingresos' ? cifra(v, 0) : entero(v);

    const lienzoHoras = this.graficoHorasRef?.nativeElement;
    if (!lienzoHoras) return;
    const hoy  = new Map<number, number>(datos.por_hora.map((h: any) => [h.hora, h[metrica]]));
    const prom = new Map<number, number>(datos.por_hora_promedio.map((h: any) => [h.hora, h[metrica]]));
    const horas = [...hoy.keys(), ...prom.keys()];
    const desde = Math.min(7, ...horas), hasta = Math.max(21, ...horas);
    const etiquetas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
    const ahora = new Date().getHours();
    const linea = coloresSignificado(this.ajustes.oscuro()).costo;
    const base = opcionesBase(t, fmt);
    base.plugins.tooltip.callbacks = {
      title: (i: any) => `${String(i[0].label).padStart(2, '0')}:00 – ${String(+i[0].label + 1).padStart(2, '0')}:00`,
      label: (i: any) => `${i.datasetIndex ? 'Un día normal' : 'Hoy'}: ${metrica === 'ingresos' ? this.enBs(i.raw) : entero(i.raw) + ' ventas'}`
    };
    base.scales.x.ticks.callback = function (this: any, v: any) { return `${this.getLabelForValue(v)}h`; };
    this.graficos.push(new Chart(lienzoHoras, {
      type: 'bar',
      data: {
        labels: etiquetas,
        datasets: [
          { data: etiquetas.map(h => hoy.get(h) || 0), backgroundColor: etiquetas.map(h => h === ahora ? t.acento : t.acentoMedio),
            borderRadius: 4, barPercentage: 0.72, categoryPercentage: 0.9, order: 2 },
          { type: 'line', data: etiquetas.map(h => prom.get(h) || 0), borderColor: linea, borderWidth: 2.5,
            pointRadius: 0, pointHoverRadius: 4, tension: 0.35, order: 1 } as any
        ]
      },
      options: base
    }));
  }
}
