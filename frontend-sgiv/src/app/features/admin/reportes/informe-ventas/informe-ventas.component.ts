import { Component, ElementRef, Injector, OnDestroy, ViewChild, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgClass } from '@angular/common';
import { Chart } from '../../../../core/utils/graficos';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { etiquetaPromocion } from '../../../../core/services/promocion.service';
import { PizzaComponent, ParteGrafico } from '../../../shared/informe/pizza.component';
import { RankingComponent, FilaRanking } from '../../../shared/informe/ranking.component';
import { cifra, entero, porcentaje, variacion, fechaCorta, fechaLarga, fechaHora, hora, temaGrafico, opcionesBase, DIAS_SEMANA } from '../../../../core/utils/informe';
import { colorCategoria, colorMetodo, coloresSignificado, indiceCategorias } from '../../../../core/utils/colores';
import { METODO_PAGO } from '../../../../core/utils/metodos-pago';

type Metrica = 'ingresos' | 'ventas';

/** Para cada número: el valor, su variación frente al período anterior y si subir es bueno */
interface Linea { nombre: string; valor: number; formato: 'bs' | 'entero'; variacion: number | null; color?: string; signo?: string; resultado?: boolean; nota?: string }

// ─── Reportes → Ventas: estado del período, cuándo, qué, quién, cómo se cobra y rentabilidad ───
// Cada gráfico abre con su cifra (la respuesta) y tiene su propio filtro cuando tiene sentido.
@Component({
  selector: 'app-informe-ventas',
  standalone: true,
  imports: [NgClass, PizzaComponent, RankingComponent],
  templateUrl: './informe-ventas.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/informe/bloques.css', './informe-ventas.component.css']
})
export class InformeVentasComponent implements OnDestroy {
  private ajustes  = inject(AjustesService);
  private injector = inject(Injector);
  readonly moneda  = this.ajustes.moneda;

  readonly datos      = input.required<any>();
  readonly todas      = input(false);
  readonly esAdmin    = input(false);
  readonly categorias = input<any[]>([]);
  readonly dias       = input(1);

  @ViewChild('graficoDias')    graficoDiasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoHoras')   graficoHorasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoSemana')  graficoSemanaRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoMetodos') graficoMetodosRef?: ElementRef<HTMLCanvasElement>;

  readonly cifra = cifra;
  readonly entero = entero;
  readonly fechaHora = fechaHora;
  readonly hora = hora;
  readonly abs = Math.abs;
  readonly diasSemana = DIAS_SEMANA;
  readonly enBs     = (v: number) => `${this.moneda()} ${cifra(v)}`;
  readonly enEntero = (v: number) => entero(v);
  readonly enPct    = (v: number) => `${cifra(v, 1)} %`;

  // ─── Filtros de cada gráfico ───
  readonly metricaDias      = signal<'ingresos' | 'ventas' | 'ticket'>('ingresos');
  readonly metricaHoras     = signal<Metrica>('ingresos');
  readonly metricaSemana    = signal<Metrica>('ingresos');
  readonly metricaCalor     = signal<Metrica>('ingresos');
  readonly metricaCategoria = signal<'ingresos' | 'unidades'>('ingresos');
  readonly metricaProductos = signal<'ingresos' | 'unidades'>('ingresos');
  readonly categoriaProductos = signal('');
  readonly verTodosProductos  = signal(false);
  readonly metricaCajeros   = signal<'ingresos' | 'ventas' | 'ticket'>('ingresos');
  readonly metricaSucursal  = signal<Metrica>('ingresos');
  readonly modoMetodos      = signal<'bs' | 'pct'>('bs');
  readonly metricaGanancia  = signal<'ganancia' | 'margen'>('ganancia');
  readonly verTodosCostos   = signal(false);
  readonly verTodosTurnos   = signal(false);

  private graficos: Chart[] = [];

  constructor() {
    effect(() => {
      this.datos(); this.ajustes.oscuro(); this.ajustes.config();
      this.metricaDias(); this.metricaHoras(); this.metricaSemana(); this.modoMetodos();
      untracked(() => afterNextRender(() => this.renderizarGraficos(), { injector: this.injector }));
    });
  }

  ngOnDestroy() { this.graficos.forEach(g => g.destroy()); }

  // ─── Resumen ───
  readonly r   = computed(() => this.datos()?.resumen || {});
  readonly ant = computed(() => this.datos()?.anterior || {});
  readonly costos = computed(() => this.datos()?.costos ?? null);
  readonly mermas = computed(() => this.datos()?.mermas ?? null);
  readonly periodoAnterior = computed(() => {
    const p = this.datos()?.periodo_anterior;
    return p ? `${fechaCorta(p[0])} – ${fechaCorta(p[1])}` : '';
  });

  /** N3 · estado del período: el administrador ve costos y mermas; el resto, ventas y ticket */
  readonly estado = computed<Linea[]>(() => {
    const r = this.r(), a = this.ant(), c = this.costos(), m = this.mermas();
    const s = coloresSignificado(this.ajustes.oscuro());
    const v = (x: any, y: any) => variacion(x, y);
    if (!c) return [
      { nombre: 'Ingresos del período', valor: r.ingresos_totales, formato: 'bs', variacion: v(r.ingresos_totales, a.ingresos_totales), color: s.ingreso },
      { nombre: 'Ventas', valor: r.total_ventas, formato: 'entero', variacion: v(r.total_ventas, a.total_ventas) },
      { nombre: 'Ticket promedio', valor: r.ticket_promedio, formato: 'bs', variacion: v(r.ticket_promedio, a.ticket_promedio) },
      { nombre: 'Unidades vendidas', valor: r.unidades, formato: 'entero', variacion: v(r.unidades, a.unidades) }
    ];
    const lineas: Linea[] = [
      { nombre: 'Ingresos del período', valor: r.ingresos_totales, formato: 'bs', variacion: v(r.ingresos_totales, a.ingresos_totales), color: s.ingreso }
    ];
    if (c.resumen.ventas_sin_costo > 0)
      lineas.push({ nombre: 'De ellos, con costo conocido', valor: c.resumen.ventas, formato: 'bs', variacion: null,
                    nota: `${entero(c.resumen.unidades_sin_costo)} u vendidas sin receta no entran en la ganancia` });
    lineas.push(
      { nombre: 'Costo de lo vendido (insumos)', valor: c.resumen.costo, formato: 'bs', variacion: null, color: s.costo, signo: '−' },
      { nombre: 'Ganancia bruta', valor: c.resumen.ganancia, formato: 'bs', variacion: null, resultado: true,
        nota: c.resumen.margen != null ? `${cifra(c.resumen.margen, 1)} % de margen` : undefined }
    );
    if (m) lineas.push(
      { nombre: 'Mermas y vencidos', valor: m.total, formato: 'bs', variacion: v(m.total, m.total_anterior), color: s.salida, signo: '−' },
      { nombre: 'Ganancia después de mermas', valor: Math.round((c.resumen.ganancia - m.total) * 100) / 100, formato: 'bs', variacion: null, resultado: true }
    );
    return lineas;
  });
  /** En las mermas, que suban es malo */
  subirEsMalo(l: Linea) { return l.nombre === 'Mermas y vencidos'; }

  readonly mejorDia = computed(() => {
    const d = (this.datos()?.ventas_diarias || []).filter((x: any) => x.ventas > 0);
    return d.length ? d.reduce((a: any, b: any) => b.ingresos > a.ingresos ? b : a) : null;
  });
  readonly fechaLarga = fechaLarga;

  // ─── Cuándo se vende ───
  readonly horaPico = computed(() => {
    const h = this.datos()?.por_hora || [];
    return h.length ? h.reduce((a: any, b: any) => b[this.metricaHoras()] > a[this.metricaHoras()] ? b : a) : null;
  });
  promedioDow(d: any, metrica: Metrica = 'ingresos'): number { return d.dias ? d[metrica] / d.dias : 0; }
  readonly mejorDiaSemana = computed(() => {
    const d = (this.datos()?.por_dia_semana || []).filter((x: any) => x.ventas > 0);
    const m = this.metricaSemana();
    return d.length ? d.reduce((a: any, b: any) => this.promedioDow(b, m) > this.promedioDow(a, m) ? b : a) : null;
  });
  readonly peorDiaSemana = computed(() => {
    const d = (this.datos()?.por_dia_semana || []).filter((x: any) => x.ventas > 0);
    const m = this.metricaSemana();
    return d.length ? d.reduce((a: any, b: any) => this.promedioDow(b, m) < this.promedioDow(a, m) ? b : a) : null;
  });

  /** R4 · mapa de calor: promedio por día de la semana y hora (5 tonos de un mismo color) */
  readonly calor = computed(() => {
    const celdas: any[] = this.datos()?.calor || [];
    const dias = new Map<number, number>((this.datos()?.por_dia_semana || []).map((d: any) => [d.dia_semana, d.dias || 1]));
    const metrica = this.metricaCalor();
    const horasUsadas = celdas.map(c => c.hora);
    const desde = Math.min(7, ...horasUsadas), hasta = Math.max(20, ...horasUsadas);
    const horas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
    const valor = new Map(celdas.map(c => [`${c.dia_semana}-${c.hora}`, c[metrica] / (dias.get(c.dia_semana) || 1)]));
    const positivos = [...valor.values()].filter(v => v > 0).sort((a, b) => a - b);
    const corte = (q: number) => positivos[Math.floor(q * (positivos.length - 1))] ?? 0;
    const cortes = [corte(0.2), corte(0.4), corte(0.6), corte(0.8)];
    let pico = { dia: 0, hora: 0, valor: 0 };
    const filas = [1, 2, 3, 4, 5, 6, 7].map(d => ({
      dia: DIAS_SEMANA[d - 1].slice(0, 3),
      celdas: horas.map(h => {
        const v = valor.get(`${d}-${h}`) || 0;
        if (v > pico.valor) pico = { dia: d, hora: h, valor: v };
        const tono = v <= 0 ? 0 : 1 + cortes.filter(c => v > c).length;
        const texto = metrica === 'ingresos' ? this.enBs(v) : `${cifra(v, 1)} ventas`;
        return { tono, nota: `${DIAS_SEMANA[d - 1]} ${String(h).padStart(2, '0')}:00 · ${texto} en promedio` };
      })
    }));
    return { horas, filas, pico, columnas: `38px repeat(${horas.length}, minmax(18px, 1fr))` };
  });

  // ─── Qué se vende ───
  private readonly indiceCat = computed(() => indiceCategorias(this.categorias()));
  readonly filasCategorias = computed<FilaRanking[]>(() => {
    const oscuro = this.ajustes.oscuro(), m = this.metricaCategoria(), total = this.r().ingresos_totales || 1;
    return (this.datos()?.por_categoria || [])
      .map((c: any) => ({ nombre: c.nombre_categoria, valor: c[m], color: colorCategoria(this.indiceCat().get(c.id_categoria) ?? -1, oscuro),
                          detalle: m === 'ingresos' ? `${cifra(porcentaje(c.ingresos, total), 0)} % · ${entero(c.unidades)} u` : this.enBs(c.ingresos) }))
      .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor);
  });
  readonly categoriaPrincipal = computed(() => {
    const l: any[] = this.datos()?.por_categoria || [];
    const p = [...l].sort((a, b) => b.ingresos - a.ingresos)[0];
    return p ? { nombre: p.nombre_categoria, porcentaje: porcentaje(p.ingresos, this.r().ingresos_totales) } : null;
  });

  readonly nombresCategoriasVendidas = computed<string[]>(() =>
    [...new Set<string>((this.datos()?.productos || []).map((p: any) => p.nombre_categoria))]);
  readonly filasProductos = computed<FilaRanking[]>(() => {
    const m = this.metricaProductos(), cat = this.categoriaProductos();
    const lista = (this.datos()?.productos || []).filter((p: any) => !cat || p.nombre_categoria === cat)
      .map((p: any) => ({ nombre: p.nombre_producto, sub: p.nombre_categoria, valor: p[m],
                          detalle: m === 'ingresos' ? `${entero(p.unidades)} u` : this.enBs(p.ingresos) }))
      .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor);
    return this.verTodosProductos() ? lista : lista.slice(0, 10);
  });
  readonly totalProductos = computed(() => (this.datos()?.productos || [])
    .filter((p: any) => !this.categoriaProductos() || p.nombre_categoria === this.categoriaProductos()).length);

  /** R6 · productos estrella (A: el 80 % de los ingresos), medios (B: hasta el 95 %) y de poca venta (C) */
  readonly abc = computed(() => {
    const lista = [...(this.datos()?.productos || [])].sort((a: any, b: any) => b.ingresos - a.ingresos);
    const total = lista.reduce((s: number, p: any) => s + p.ingresos, 0);
    const grupos = { A: [] as any[], B: [] as any[], C: [] as any[] };
    let acumulado = 0;
    for (const p of lista) {
      const antes = total ? acumulado / total : 0;
      acumulado += p.ingresos;
      (antes < 0.8 ? grupos.A : antes < 0.95 ? grupos.B : grupos.C).push(p);
    }
    const resumen = (l: any[]) => ({ cantidad: l.length, monto: l.reduce((s, p) => s + p.ingresos, 0),
                                    porcentaje: porcentaje(l.reduce((s, p) => s + p.ingresos, 0), total),
                                    nombres: l.slice(0, 4).map(p => p.nombre_producto) });
    return { A: resumen(grupos.A), B: resumen(grupos.B), C: resumen(grupos.C), total };
  });

  // ─── Quién vende ───
  readonly filasCajeros = computed<FilaRanking[]>(() => {
    const m = this.metricaCajeros();
    return (this.datos()?.por_cajero || [])
      .map((c: any) => ({ nombre: c.cajero, valor: c[m],
                          detalle: m === 'ingresos' ? `${entero(c.ventas)} ventas` : m === 'ventas' ? this.enBs(c.ingresos) : `${entero(c.ventas)} ventas` }))
      .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor);
  });
  readonly filasSucursales = computed<FilaRanking[]>(() => {
    const m = this.metricaSucursal();
    return (this.datos()?.por_sucursal || []).map((s: any) => ({
      nombre: s.nombre_sucursal, valor: s[m],
      detalle: m === 'ingresos' ? `ticket ${this.enBs(s.ticket)}` : this.enBs(s.ingresos)
    }));
  });

  // ─── Cómo se cobra ───
  readonly partesMetodos = computed<ParteGrafico[]>(() => {
    const oscuro = this.ajustes.oscuro();
    return (this.datos()?.metodos_pago || []).map((m: any) => ({ nombre: m.metodo_pago, valor: m.ingresos, color: colorMetodo(m.metodo_pago, oscuro) }));
  });
  readonly partEfectivo = computed(() => {
    const t = this.partesMetodos().reduce((s, p) => s + p.valor, 0);
    return porcentaje(this.partesMetodos().find(p => p.nombre === METODO_PAGO.efectivo)?.valor || 0, t);
  });

  // ─── Rentabilidad (solo administrador) ───
  readonly filasGanancia = computed<FilaRanking[]>(() => {
    const oscuro = this.ajustes.oscuro(), m = this.metricaGanancia();
    return (this.costos()?.por_categoria || [])
      .map((c: any) => ({ nombre: c.nombre_categoria, valor: m === 'ganancia' ? Math.max(0, c.ganancia) : Math.max(0, c.margen ?? 0),
                          color: colorCategoria(this.indiceCat().get(c.id_categoria) ?? -1, oscuro),
                          detalle: m === 'ganancia' ? `${cifra(c.margen ?? 0, 0)} % de margen` : this.enBs(c.ganancia) }))
      .sort((a: FilaRanking, b: FilaRanking) => b.valor - a.valor);
  });
  readonly mayorMargen = computed(() => {
    const l: any[] = this.costos()?.por_categoria || [];
    return l.length ? l.reduce((a, b) => (b.margen ?? 0) > (a.margen ?? 0) ? b : a) : null;
  });
  readonly productosCosto = computed(() => {
    const p = this.costos()?.productos || [];
    return this.verTodosCostos() ? p : p.slice(0, 10);
  });
  readonly partesMermas = computed<ParteGrafico[]>(() => {
    const s = coloresSignificado(this.ajustes.oscuro());
    const color: Record<string, string> = { 'Vencido': s.costo, 'Dañado': s.salida, 'Degustación': colorCategoria(6, this.ajustes.oscuro()),
                                            'Consumo interno': colorCategoria(0, this.ajustes.oscuro()) };
    return (this.mermas()?.por_motivo || []).filter((m: any) => m.valor > 0)
      .map((m: any) => ({ nombre: m.motivo, valor: m.valor, color: color[m.motivo] || s.gris }));
  });
  readonly mermaPrincipal = computed(() => {
    const p = this.partesMermas(), t = p.reduce((s, x) => s + x.valor, 0);
    return p.length ? { nombre: p[0].nombre, porcentaje: porcentaje(p[0].valor, t) } : null;
  });

  // ─── Promociones, menú QR y turnos ───
  readonly descuentos = computed(() => this.datos()?.descuentos ?? null);
  readonly hayDescuentos = computed(() => {
    const r = this.descuentos()?.resumen;
    return !!r && (r.promociones > 0 || r.manual > 0);
  });
  etiquetaPromo(p: any): string { return etiquetaPromocion(p, this.moneda()); }
  readonly tasaCancelacion = computed(() => porcentaje(this.datos()?.pedidos_qr?.cancelados, this.datos()?.pedidos_qr?.total));
  readonly turnosVisibles = computed<any[]>(() => {
    const t = this.datos()?.cierres || [];
    return this.verTodosTurnos() ? t : t.slice(0, 8);
  });
  readonly totalTurnos = computed(() => (this.datos()?.cierres || []).reduce((s: number, t: any) => s + t.total, 0));

  // ─── Gráficos ───
  private renderizarGraficos() {
    this.graficos.forEach(g => g.destroy());
    this.graficos = [];
    const datos = this.datos();
    if (!datos) return;
    const t = temaGrafico(this.ajustes);
    const oscuro = this.ajustes.oscuro();
    const mon = this.moneda();

    // R2 · tendencia por día (área)
    const lienzoDias = this.graficoDiasRef?.nativeElement;
    const dias = datos.ventas_diarias || [];
    if (lienzoDias && dias.length) {
      const m = this.metricaDias();
      const valor = (d: any) => m === 'ticket' ? (d.ventas ? d.ingresos / d.ventas : 0) : d[m];
      const fmt = (v: number) => m === 'ventas' ? entero(v) : cifra(v, 0);
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => fechaLarga(dias[i[0].dataIndex].dia),
        label: (i: any) => m === 'ventas' ? `${entero(i.raw)} ventas` : `${mon} ${cifra(i.raw)}${m === 'ingresos' ? ` · ${dias[i.dataIndex].ventas} ventas` : ''}`
      };
      base.scales.x.ticks.maxTicksLimit = 10;
      const color = colorCategoria(2, oscuro);
      const ctx = lienzoDias.getContext('2d')!;
      const relleno = ctx.createLinearGradient(0, 0, 0, lienzoDias.clientHeight || 230);
      relleno.addColorStop(0, color + '55');
      relleno.addColorStop(1, color + '00');
      this.graficos.push(new Chart(lienzoDias, {
        type: 'line',
        data: { labels: dias.map((d: any) => fechaCorta(d.dia)),
                datasets: [{ data: dias.map(valor), borderColor: color, backgroundColor: relleno, fill: true, borderWidth: 2.5,
                             tension: 0.3, pointRadius: dias.length > 31 ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: color }] },
        options: base
      }));
    }

    // R3 · horas de mayor venta (la hora pico resaltada)
    const lienzoHoras = this.graficoHorasRef?.nativeElement;
    if (lienzoHoras && datos.por_hora?.length) {
      const m = this.metricaHoras();
      const mapa = new Map<number, any>(datos.por_hora.map((h: any) => [h.hora, h]));
      const lista = [...mapa.keys()];
      const desde = Math.min(7, ...lista), hasta = Math.max(21, ...lista);
      const etiquetas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
      const pico = this.horaPico()?.hora;
      const base = opcionesBase(t, (v: number) => m === 'ventas' ? entero(v) : cifra(v, 0));
      base.plugins.tooltip.callbacks = {
        title: (i: any) => `${String(etiquetas[i[0].dataIndex]).padStart(2, '0')}:00 – ${String(etiquetas[i[0].dataIndex] + 1).padStart(2, '0')}:00`,
        label: (i: any) => m === 'ventas' ? `${entero(i.raw)} ventas` : `${mon} ${cifra(i.raw)} · ${mapa.get(etiquetas[i.dataIndex])?.ventas || 0} ventas`
      };
      const violeta = colorCategoria(6, oscuro);
      this.graficos.push(new Chart(lienzoHoras, {
        type: 'bar',
        data: { labels: etiquetas.map(h => `${h}h`),
                datasets: [{ data: etiquetas.map(h => mapa.get(h)?.[m] || 0),
                             backgroundColor: etiquetas.map(h => h === pico ? colorCategoria(1, oscuro) : violeta),
                             borderRadius: 4, barPercentage: 0.75 }] },
        options: base
      }));
    }

    // R3 · promedio por día de la semana (el mejor resaltado)
    const lienzoSemana = this.graficoSemanaRef?.nativeElement;
    if (lienzoSemana && datos.por_dia_semana?.length) {
      const m = this.metricaSemana();
      const dow = datos.por_dia_semana;
      const mejor = this.mejorDiaSemana()?.dia_semana;
      const base = opcionesBase(t, (v: number) => m === 'ventas' ? cifra(v, 1) : cifra(v, 0));
      base.plugins.tooltip.callbacks = {
        title: (i: any) => DIAS_SEMANA[dow[i[0].dataIndex].dia_semana - 1],
        label: (i: any) => `Promedio: ${m === 'ventas' ? cifra(i.raw, 1) + ' ventas' : mon + ' ' + cifra(i.raw)} (${dow[i.dataIndex].dias} día/s)`
      };
      this.graficos.push(new Chart(lienzoSemana, {
        type: 'bar',
        data: { labels: dow.map((d: any) => DIAS_SEMANA[d.dia_semana - 1].slice(0, 3)),
                datasets: [{ data: dow.map((d: any) => this.promedioDow(d, m)),
                             backgroundColor: dow.map((d: any) => d.dia_semana === mejor ? colorCategoria(1, oscuro) : colorCategoria(0, oscuro)),
                             borderRadius: 4, barPercentage: 0.6 }] },
        options: base
      }));
    }

    // R9 · efectivo y QR por día (barras apiladas, en dinero o en porcentaje)
    const lienzoMetodos = this.graficoMetodosRef?.nativeElement;
    const porDia: any[] = datos.metodos_por_dia || [];
    if (lienzoMetodos && porDia.length) {
      const pct = this.modoMetodos() === 'pct';
      const diasM = [...new Set(porDia.map(x => x.dia))].sort();
      const metodos = [...new Set(porDia.map(x => x.metodo_pago))];
      const total = new Map(diasM.map(d => [d, porDia.filter(x => x.dia === d).reduce((s, x) => s + x.ingresos, 0)]));
      const base = opcionesBase(t, (v: number) => pct ? `${cifra(v, 0)} %` : cifra(v, 0));
      base.scales.x.stacked = true;
      base.scales.y.stacked = true;
      if (pct) base.scales.y.max = 100;
      base.plugins.legend = { display: true, position: 'top', align: 'end',
        labels: { color: t.texto, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } };
      base.plugins.tooltip.callbacks = {
        title: (i: any) => fechaLarga(diasM[i[0].dataIndex]),
        label: (i: any) => `${i.dataset.label}: ${pct ? cifra(i.raw, 0) + ' %' : mon + ' ' + cifra(i.raw)}`
      };
      base.plugins.tooltip.displayColors = true;
      this.graficos.push(new Chart(lienzoMetodos, {
        type: 'bar',
        data: { labels: diasM.map(d => fechaCorta(d)),
                datasets: metodos.map((mp, i) => ({
                  label: mp,
                  data: diasM.map(d => {
                    const v = porDia.find(x => x.dia === d && x.metodo_pago === mp)?.ingresos || 0;
                    return pct ? (total.get(d) ? v * 100 / total.get(d)! : 0) : v;
                  }),
                  backgroundColor: colorMetodo(mp, oscuro),
                  borderColor: getComputedStyle(lienzoMetodos).getPropertyValue('--i-papel').trim() || '#fff',
                  borderWidth: i ? { top: 2 } : 0,
                  borderRadius: i === metodos.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
                  barPercentage: 0.75
                })) },
        options: base
      }));
    }
  }
}
