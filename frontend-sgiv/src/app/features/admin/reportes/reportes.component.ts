import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, effect, untracked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { LucideAngularModule, ChevronDown, ChevronRight, X, Check, SlidersHorizontal, FileSpreadsheet, FileText, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-angular';
import { ReporteService } from '../../../core/services/reporte.service';
import { ProductoService } from '../../../core/services/producto.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { cifra, entero, variacion, porcentaje, fechaCorta, fechaLarga, fechaHora, hora, temaGrafico, opcionesBase, DIAS_SEMANA } from '../../../core/utils/informe';
Chart.register(...registerables);

type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes_anterior' | 'personalizado';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, SelectorSucursalComponent],
  templateUrl: './reportes.component.html',
  styleUrls: ['../../shared/informe/informe.css', './reportes.component.css']
})
export class ReportesComponent implements OnInit, OnDestroy {
  private reporteService  = inject(ReporteService);
  private productoService = inject(ProductoService);
  private sucursalService = inject(SucursalService);
  private ajustes         = inject(AjustesService);
  private cdr             = inject(ChangeDetectorRef);
  readonly moneda         = this.ajustes.moneda;

  @ViewChild('graficoDiario') graficoDiarioRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoHoras')  graficoHorasRef?:  ElementRef<HTMLCanvasElement>;
  @ViewChild('graficoSemana') graficoSemanaRef?: ElementRef<HTMLCanvasElement>;

  readonly icons = {
    abajo: ChevronDown, derecha: ChevronRight, cerrar: X, check: Check, filtro: SlidersHorizontal,
    excel: FileSpreadsheet, pdf: FileText, sube: ArrowUpRight, baja: ArrowDownRight, igual: Minus
  };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly porcentaje = porcentaje;
  readonly fechaCorta = fechaCorta;
  readonly hora = hora;
  readonly fechaHora = fechaHora;
  readonly diasSemana = DIAS_SEMANA;

  readonly periodos: { id: Periodo; nombre: string }[] = [
    { id: 'hoy', nombre: 'Hoy' }, { id: 'ayer', nombre: 'Ayer' }, { id: 'semana', nombre: 'Esta semana' },
    { id: 'mes', nombre: 'Este mes' }, { id: 'mes_anterior', nombre: 'Mes anterior' }, { id: 'personalizado', nombre: 'Personalizado' }
  ];

  cargando    = false;
  refrescando = false;
  error       = '';
  datos: any  = null;
  periodo: Periodo = 'mes';
  fechaInicio = '';
  fechaFin    = '';

  esAdmin = false;
  sucursales: any[] = [];
  sucursalSeleccionada: number | null = 1;   // null = todas

  categoriasDisponibles: any[] = [];
  categoriasSeleccionadas = new Set<number>();
  mostrarFiltroCategorias = false;

  verTodosProductos = false;
  verTodosTurnos    = false;
  verSinVentas      = false;

  diasExpandidos = new Set<string>();
  desglosePorDia: Record<string, any> = {};
  cargandoDia: Record<string, boolean> = {};

  private reporteSub: Subscription | null = null;
  private debounceTimer: any = null;
  private graficos: Chart[] = [];

  constructor() {
    effect(() => {
      this.ajustes.oscuro();
      this.ajustes.config();
      untracked(() => this.renderizarGraficos());
    });
  }

  ngOnInit() {
    try {
      const u = JSON.parse(localStorage.getItem('usuario_sgiv') || 'null');
      this.esAdmin = u?.id_rol === 1;
      this.sucursalSeleccionada = u?.id_sucursal || 1;
    } catch { }
    this.sucursalService.listarSucursales().subscribe({
      next: (s: any[]) => { this.sucursales = s || []; this.cdr.detectChanges(); }
    });
    this.productoService.obtenerCategorias().subscribe({
      next: (c) => { this.categoriasDisponibles = c || []; this.cdr.detectChanges(); }
    });
    this.seleccionarPeriodo('mes');
  }

  ngOnDestroy() {
    this.reporteSub?.unsubscribe();
    clearTimeout(this.debounceTimer);
    this.graficos.forEach(g => g.destroy());
  }

  // ─── Filtros ───
  private fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  seleccionarPeriodo(p: Periodo) {
    this.periodo = p;
    const hoy = new Date();
    const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
    const rangos: Record<string, [Date, Date]> = {
      hoy:          [hoy, hoy],
      ayer:         [new Date(y, m, d - 1), new Date(y, m, d - 1)],
      semana:       [new Date(y, m, d - ((hoy.getDay() + 6) % 7)), hoy],
      mes:          [new Date(y, m, 1), hoy],
      mes_anterior: [new Date(y, m - 1, 1), new Date(y, m, 0)]
    };
    if (p === 'personalizado') return;
    [this.fechaInicio, this.fechaFin] = rangos[p].map(x => this.fmt(x));
    this.cargarReporte();
  }

  cambiarSucursal(id: number | null) {
    this.sucursalSeleccionada = id;
    this.cargarReporte();
  }

  toggleCategoria(id: number) {
    if (this.categoriasSeleccionadas.has(id)) this.categoriasSeleccionadas.delete(id);
    else this.categoriasSeleccionadas.add(id);
    this.programarRefresco();
  }

  limpiarCategorias() {
    if (!this.categoriasSeleccionadas.size) return;
    this.categoriasSeleccionadas.clear();
    this.programarRefresco();
  }

  private programarRefresco() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.cargarReporte(true), 150);
  }

  get textoFiltroCategorias(): string {
    const n = this.categoriasSeleccionadas.size;
    if (n === 0) return 'Todas las categorías';
    if (n === 1) {
      const id = [...this.categoriasSeleccionadas][0];
      return this.categoriasDisponibles.find(c => c.id_categoria === id)?.nombre_categoria || '1 categoría';
    }
    return `${n} categorías`;
  }

  private get nombresCategorias(): string {
    return this.categoriasSeleccionadas.size
      ? this.categoriasDisponibles.filter(c => this.categoriasSeleccionadas.has(c.id_categoria)).map(c => c.nombre_categoria).join(', ')
      : 'Todas';
  }

  cargarReporte(silencioso = false) {
    this.error = '';
    if (!this.fechaInicio || !this.fechaFin) return;
    if (this.fechaInicio > this.fechaFin) { this.error = 'La fecha de inicio no puede ser posterior a la fecha final.'; return; }

    this.reporteSub?.unsubscribe();
    if (silencioso && this.datos) this.refrescando = true;
    else this.cargando = true;

    this.reporteSub = this.reporteService
      .obtenerReportePeriodo(this.sucursalSeleccionada ?? 0, this.fechaInicio, this.fechaFin, [...this.categoriasSeleccionadas])
      .subscribe({
        next: (d) => {
          this.datos = d;
          this.cargando = this.refrescando = false;
          this.diasExpandidos.clear();
          this.desglosePorDia = {};
          this.cdr.detectChanges();
          setTimeout(() => this.renderizarGraficos());
        },
        error: (e) => {
          this.cargando = this.refrescando = false;
          this.error = e?.error?.error || 'No se pudo generar el informe.';
          this.cdr.detectChanges();
        }
      });
  }

  // ─── Desglose por día ───
  toggleDia(d: any) {
    if (!d.ventas) return;
    if (this.diasExpandidos.has(d.dia)) { this.diasExpandidos.delete(d.dia); return; }
    this.diasExpandidos.add(d.dia);
    if (this.desglosePorDia[d.dia]) return;
    this.cargandoDia[d.dia] = true;
    this.reporteService.obtenerDesgloseDia(this.sucursalSeleccionada ?? 0, d.dia).subscribe({
      next: (r) => { this.desglosePorDia[d.dia] = r; this.cargandoDia[d.dia] = false; this.cdr.detectChanges(); },
      error: () => { this.desglosePorDia[d.dia] = { desglose: [] }; this.cargandoDia[d.dia] = false; this.cdr.detectChanges(); }
    });
  }

  // ─── Datos derivados ───
  get r()   { return this.datos?.resumen  || {}; }
  get ant() { return this.datos?.anterior || {}; }
  get todas() { return this.sucursalSeleccionada === null; }

  get nombreSucursal(): string {
    if (this.todas) return 'Todas las sucursales';
    return this.sucursales.find(s => s.id_sucursal === this.sucursalSeleccionada)?.nombre_sucursal || 'Sucursal';
  }

  get diasPeriodo(): number {
    return Math.round((Date.parse(this.fechaFin) - Date.parse(this.fechaInicio)) / 86400000) + 1;
  }

  get textoPeriodo(): string {
    if (!this.fechaInicio) return '';
    return this.fechaInicio === this.fechaFin
      ? fechaLarga(this.fechaInicio)
      : `${fechaCorta(this.fechaInicio)} – ${fechaCorta(this.fechaFin)} ${this.fechaFin.slice(0, 4)}`;
  }

  get textoPeriodoAnterior(): string {
    const [a, b] = this.datos?.periodo_anterior || [];
    if (!a) return '';
    return a === b ? fechaCorta(a) : `${fechaCorta(a)} – ${fechaCorta(b)}`;
  }

  get vsIngresos() { return variacion(this.r.ingresos_totales, this.ant.ingresos_totales); }
  get vsVentas()   { return variacion(this.r.total_ventas, this.ant.total_ventas); }
  get vsTicket()   { return variacion(this.r.ticket_promedio, this.ant.ticket_promedio); }
  get vsUnidades() { return variacion(this.r.unidades, this.ant.unidades); }
  get promedioDiario(): number { return (this.r.ingresos_totales || 0) / Math.max(1, this.diasPeriodo); }

  get mejorDia() {
    const d = (this.datos?.ventas_diarias || []).filter((x: any) => x.ventas > 0);
    return d.length ? d.reduce((a: any, b: any) => b.ingresos > a.ingresos ? b : a) : null;
  }

  get horaPico() {
    const h = this.datos?.por_hora || [];
    return h.length ? h.reduce((a: any, b: any) => b.ingresos > a.ingresos ? b : a) : null;
  }

  get mejorDiaSemana() {
    const d = (this.datos?.por_dia_semana || []).filter((x: any) => x.ventas > 0);
    return d.length ? d.reduce((a: any, b: any) => this.promedioDow(b) > this.promedioDow(a) ? b : a) : null;
  }

  diaSemanaDe(dia: string): string {
    return DIAS_SEMANA[(new Date(dia + 'T00:00:00').getDay() + 6) % 7].slice(0, 3).toLowerCase();
  }

  promedioDow(d: any): number { return d.dias ? d.ingresos / d.dias : 0; }

  get productosVisibles(): any[] {
    const p = this.datos?.productos || [];
    return this.verTodosProductos ? p : p.slice(0, 10);
  }

  get turnosVisibles(): any[] {
    const t = this.datos?.cierres || [];
    return this.verTodosTurnos ? t : t.slice(0, 8);
  }

  /** Productos sin ventas agrupados por categoría */
  get sinVentasPorCategoria(): { categoria: string; productos: any[] }[] {
    const grupos = new Map<string, any[]>();
    for (const p of this.datos?.sin_ventas || []) {
      if (!grupos.has(p.nombre_categoria)) grupos.set(p.nombre_categoria, []);
      grupos.get(p.nombre_categoria)!.push(p);
    }
    return [...grupos].map(([categoria, productos]) => ({ categoria, productos }));
  }

  get resumenSinVentas() {
    const l = this.datos?.sin_ventas || [];
    const conStock = l.filter((p: any) => p.stock > 0);
    return {
      conStock: conStock.length,
      unidades: conStock.reduce((s: number, p: any) => s + p.stock, 0),
      valor:    conStock.reduce((s: number, p: any) => s + p.stock * p.precio, 0),
      agotados: l.length - conStock.length
    };
  }

  get totalTurnos(): number { return (this.datos?.cierres || []).reduce((s: number, t: any) => s + t.total, 0); }
  get maxCategoria(): number { return Math.max(1, ...(this.datos?.por_categoria || []).map((c: any) => c.ingresos)); }
  get tasaCancelacion(): number { return porcentaje(this.datos?.pedidos_qr?.cancelados, this.datos?.pedidos_qr?.total); }

  colorSerie(i: number): string { return temaGrafico(this.ajustes).serie[i % 6]; }

  claseDelta(v: number | null): string {
    if (v === null || Math.abs(v) < 0.5) return 'igual';
    return v > 0 ? 'sube' : 'baja';
  }

  iconoDelta(v: number | null) {
    const c = this.claseDelta(v);
    return c === 'sube' ? this.icons.sube : c === 'baja' ? this.icons.baja : this.icons.igual;
  }

  textoDelta(v: number | null): string {
    return v === null ? 'sin base' : `${Math.abs(v).toFixed(1)} %`;
  }

  // ─── Gráficos ───
  private renderizarGraficos() {
    this.graficos.forEach(g => g.destroy());
    this.graficos = [];
    if (!this.datos) return;
    const t = temaGrafico(this.ajustes);
    const fmt = (v: number) => cifra(v, 0);
    const mon = this.moneda();

    const diario = this.graficoDiarioRef?.nativeElement;
    const dias = this.datos.ventas_diarias || [];
    if (diario && dias.length) {
      const prom = this.promedioDiario;
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => fechaLarga(dias[i[0].dataIndex].dia),
        label: (i: any) => i.datasetIndex ? `Promedio diario: ${mon} ${cifra(i.raw)}` : `${mon} ${cifra(i.raw)} · ${dias[i.dataIndex].ventas} ventas`
      };
      this.graficos.push(new Chart(diario, {
        type: dias.length > 45 ? 'line' : 'bar',
        data: {
          labels: dias.map((d: any) => fechaCorta(d.dia)),
          datasets: [
            {
              data: dias.map((d: any) => d.ingresos),
              backgroundColor: dias.length > 45 ? t.acentoSuave : t.acentoMedio,
              borderColor: t.acento, borderWidth: dias.length > 45 ? 2 : 0,
              fill: dias.length > 45, pointRadius: 0, tension: 0.3, borderRadius: 3, barPercentage: 0.8, order: 2
            } as any,
            {
              type: 'line', data: dias.map(() => prom),
              borderColor: t.texto, borderWidth: 1, borderDash: [4, 4], pointRadius: 0, order: 1
            } as any
          ]
        },
        options: base
      }));
    }

    const horas = this.graficoHorasRef?.nativeElement;
    if (horas && this.datos.por_hora?.length) {
      const mapa = new Map<number, any>(this.datos.por_hora.map((h: any) => [h.hora, h]));
      const lista = [...mapa.keys()];
      const desde = Math.min(7, ...lista), hasta = Math.max(21, ...lista);
      const etiquetas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
      const pico = this.horaPico?.hora;
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => `${String(etiquetas[i[0].dataIndex]).padStart(2, '0')}:00 – ${String(etiquetas[i[0].dataIndex] + 1).padStart(2, '0')}:00`,
        label: (i: any) => `${mon} ${cifra(i.raw)} · ${mapa.get(etiquetas[i.dataIndex])?.ventas || 0} ventas`
      };
      this.graficos.push(new Chart(horas, {
        type: 'bar',
        data: {
          labels: etiquetas.map(h => `${h}h`),
          datasets: [{
            data: etiquetas.map(h => mapa.get(h)?.ingresos || 0),
            backgroundColor: etiquetas.map(h => h === pico ? t.acento : t.fantasma),
            borderRadius: 3, barPercentage: 0.75
          }]
        },
        options: base
      }));
    }

    const semana = this.graficoSemanaRef?.nativeElement;
    if (semana && this.datos.por_dia_semana?.length) {
      const dow = this.datos.por_dia_semana;
      const mejor = this.mejorDiaSemana?.dia_semana;
      const base = opcionesBase(t, fmt);
      base.plugins.tooltip.callbacks = {
        title: (i: any) => DIAS_SEMANA[dow[i[0].dataIndex].dia_semana - 1],
        label: (i: any) => `Promedio: ${mon} ${cifra(i.raw)} (${dow[i.dataIndex].dias} día/s)`
      };
      this.graficos.push(new Chart(semana, {
        type: 'bar',
        data: {
          labels: dow.map((d: any) => DIAS_SEMANA[d.dia_semana - 1].slice(0, 3)),
          datasets: [{
            data: dow.map((d: any) => this.promedioDow(d)),
            backgroundColor: dow.map((d: any) => d.dia_semana === mejor ? t.acento : t.fantasma),
            borderRadius: 3, barPercentage: 0.6
          }]
        },
        options: base
      }));
    }
  }

  // ─── Exportar PDF ───
  async exportarPDF() {
    if (!this.datos) return;
    const d = this.datos;
    const doc = new jsPDF();
    const color = this.ajustes.colorPrimarioRgb();
    const nombre = this.ajustes.nombre();
    const mon = this.moneda();
    const m = (n: any) => `${mon} ${cifra(n).replace('−', '-')}`;
    const delta = (v: number | null) => v === null ? '—' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)} %`;

    // Encabezado: logo, nombre y una regla de color
    const logo = await this.ajustes.logoComoDataUri();
    let x = 14;
    if (logo) {
      try { doc.addImage(logo, 14, 10, 16, 16, undefined, 'FAST'); x = 34; } catch { /* formato no soportado */ }
    }
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(nombre, x, 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(100, 116, 139);
    doc.text('Informe de ventas', x, 23);
    doc.text(`Generado: ${fechaLarga(new Date())} ${hora(new Date())}`, 196, 17, { align: 'right' });
    doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.line(14, 30, 196, 30);

    doc.setFontSize(9); doc.setTextColor(51, 65, 85);
    doc.text(`Período: ${this.fechaInicio} al ${this.fechaFin} (${this.diasPeriodo} días)`, 14, 37);
    doc.text(`Sucursal: ${this.nombreSucursal}`, 14, 42);
    doc.text(`Categorías: ${this.nombresCategorias}`, 14, 47);

    let y = 54;
    const seccion = (titulo: string) => {
      y = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 10 : y;
      if (y > 255) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...color);
      doc.text(titulo, 14, y);
      y += 3;
    };
    const tabla = (head: string[], body: any[][], derecha: number[] = []) => {
      const columnStyles: any = {};
      derecha.forEach(i => columnStyles[i] = { halign: 'right' });
      autoTable(doc, {
        startY: y, head: [head], body, theme: 'plain',
        styles: { fontSize: 8.5, cellPadding: 1.8, textColor: [51, 65, 85] },
        headStyles: { textColor: [100, 116, 139], fontStyle: 'bold', lineWidth: { bottom: 0.3 }, lineColor: [203, 213, 225] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles, margin: { left: 14, right: 14 }
      });
    };

    seccion('Resumen del período');
    tabla(['Indicador', 'Período', `Anterior (${this.textoPeriodoAnterior})`, 'Variación'], [
      ['Ingresos', m(d.resumen.ingresos_totales), m(d.anterior.ingresos_totales), delta(this.vsIngresos)],
      ['Ventas', entero(d.resumen.total_ventas), entero(d.anterior.total_ventas), delta(this.vsVentas)],
      ['Ticket promedio', m(d.resumen.ticket_promedio), m(d.anterior.ticket_promedio), delta(this.vsTicket)],
      ['Unidades vendidas', entero(d.resumen.unidades), entero(d.anterior.unidades), delta(this.vsUnidades)],
      ['Promedio diario', m(this.promedioDiario), '', ''],
      ['Venta más alta', m(d.resumen.venta_maxima), '', ''],
      ['Días con venta', `${d.resumen.dias_con_venta} de ${this.diasPeriodo}`, '', '']
    ], [1, 2, 3]);

    if (d.por_sucursal?.length) {
      seccion('Por sucursal');
      tabla(['Sucursal', 'Ventas', 'Ingresos', 'Ticket', '%'],
        d.por_sucursal.map((s: any) => [s.nombre_sucursal, s.ventas, m(s.ingresos), m(s.ticket), `${porcentaje(s.ingresos, d.resumen.ingresos_totales).toFixed(1)} %`]), [1, 2, 3, 4]);
    }
    if (d.metodos_pago?.length) {
      seccion('Cobros por método de pago');
      tabla(['Método', 'Ventas', 'Ingresos', '%'],
        d.metodos_pago.map((x: any) => [x.metodo_pago, x.ventas, m(x.ingresos), `${porcentaje(x.ingresos, d.resumen.ingresos_totales).toFixed(1)} %`]), [1, 2, 3]);
    }
    if (d.por_cajero?.length) {
      seccion('Ventas por cajero');
      tabla(['Cajero', 'Ventas', 'Ingresos', 'Ticket promedio'],
        d.por_cajero.map((c: any) => [c.cajero, c.ventas, m(c.ingresos), m(c.ticket)]), [1, 2, 3]);
    }
    if (d.por_categoria?.length) {
      seccion('Ventas por categoría');
      tabla(['Categoría', 'Unidades', 'Ingresos', '%'],
        d.por_categoria.map((c: any) => [c.nombre_categoria, c.unidades, m(c.ingresos), `${porcentaje(c.ingresos, d.resumen.ingresos_totales).toFixed(1)} %`]), [1, 2, 3]);
    }
    if (d.productos?.length) {
      seccion('Productos vendidos');
      tabla(['#', 'Producto', 'Categoría', 'Unidades', 'Ingresos', '%'],
        d.productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, p.unidades, m(p.ingresos), `${porcentaje(p.ingresos, d.resumen.ingresos_totales).toFixed(1)} %`]), [3, 4, 5]);
    }
    seccion('Ventas por día');
    tabla(['Fecha', 'Ventas', 'Ingresos'],
      d.ventas_diarias.map((x: any) => [x.dia, x.ventas, m(x.ingresos)]), [1, 2]);
    if (d.cierres?.length) {
      seccion('Turnos de caja cerrados');
      tabla(['Cajero', 'Sucursal', 'Cierre', 'Ventas', 'Efectivo', 'Total', 'Diferencia'],
        d.cierres.map((c: any) => [c.cajero, c.nombre_sucursal, fechaHora(c.fecha_hora_cierre), c.ventas, m(c.efectivo), m(c.total),
          c.diferencia === null ? 'sin conteo' : m(c.diferencia)]), [3, 4, 5, 6]);
    }
    if (d.sin_ventas?.length) {
      seccion('Productos activos sin ventas en el período');
      tabla(['Producto', 'Categoría', 'Stock actual', 'Valor en stock'],
        d.sin_ventas.map((p: any) => [p.nombre_producto, p.nombre_categoria, p.stock, m(p.stock * p.precio)]), [2, 3]);
    }

    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
      doc.text(`${nombre} · Informe de ventas ${this.fechaInicio} al ${this.fechaFin}`, 14, 289);
      doc.text(`Página ${i} de ${total}`, 196, 289, { align: 'right' });
    }
    doc.save(`Informe_${this.nombreArchivo}_${this.fechaInicio}_${this.fechaFin}.pdf`);
  }

  // ─── Exportar Excel ───
  exportarExcel() {
    if (!this.datos) return;
    const d = this.datos;
    const mon = this.moneda();
    const wb = XLSX.utils.book_new();
    const hoja = (nombre: string, filas: any[][], anchos: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = anchos.map(wch => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, nombre);
    };
    const pct = (a: number) => +porcentaje(a, d.resumen.ingresos_totales).toFixed(2);

    hoja('Resumen', [
      [`INFORME DE VENTAS — ${this.ajustes.nombre()}`],
      ['Período', `${this.fechaInicio} al ${this.fechaFin}`],
      ['Sucursal', this.nombreSucursal],
      ['Categorías', this.nombresCategorias],
      [],
      ['Indicador', 'Período', 'Período anterior', 'Variación %'],
      [`Ingresos (${mon})`, d.resumen.ingresos_totales, d.anterior.ingresos_totales, this.vsIngresos === null ? '' : +this.vsIngresos.toFixed(2)],
      ['Ventas', d.resumen.total_ventas, d.anterior.total_ventas, this.vsVentas === null ? '' : +this.vsVentas.toFixed(2)],
      [`Ticket promedio (${mon})`, d.resumen.ticket_promedio, d.anterior.ticket_promedio, this.vsTicket === null ? '' : +this.vsTicket.toFixed(2)],
      ['Unidades', d.resumen.unidades, d.anterior.unidades, this.vsUnidades === null ? '' : +this.vsUnidades.toFixed(2)],
      [`Promedio diario (${mon})`, +this.promedioDiario.toFixed(2)],
      [`Venta más alta (${mon})`, d.resumen.venta_maxima],
      ['Días con venta', d.resumen.dias_con_venta, `de ${this.diasPeriodo}`],
      [],
      ['Inventario actual'],
      ['Productos', d.inventario.productos], ['Unidades en stock', d.inventario.unidades],
      [`Valor a precio de venta (${mon})`, d.inventario.valor_venta],
      ['Agotados', d.inventario.agotados], ['Bajo mínimo', d.inventario.bajos],
      [],
      ['Pedidos del menú QR'],
      ['Recibidos', d.pedidos_qr.total], ['Atendidos', d.pedidos_qr.atendidos], ['Cancelados', d.pedidos_qr.cancelados],
      [`Monto (${mon})`, d.pedidos_qr.monto]
    ], [32, 22, 22, 14]);
    hoja('Por día', [['Fecha', 'Ventas', `Ingresos (${mon})`], ...d.ventas_diarias.map((x: any) => [x.dia, x.ventas, x.ingresos])], [14, 10, 16]);
    if (d.por_sucursal?.length)
      hoja('Por sucursal', [['Sucursal', 'Ventas', `Ingresos (${mon})`, `Ticket (${mon})`, '%'], ...d.por_sucursal.map((s: any) => [s.nombre_sucursal, s.ventas, s.ingresos, s.ticket, pct(s.ingresos)])], [24, 10, 16, 14, 8]);
    hoja('Métodos de pago', [['Método', 'Ventas', `Ingresos (${mon})`, '%'], ...d.metodos_pago.map((x: any) => [x.metodo_pago, x.ventas, x.ingresos, pct(x.ingresos)])], [18, 10, 16, 8]);
    hoja('Cajeros', [['Cajero', 'Ventas', `Ingresos (${mon})`, `Ticket (${mon})`], ...d.por_cajero.map((c: any) => [c.cajero, c.ventas, c.ingresos, c.ticket])], [28, 10, 16, 14]);
    hoja('Por hora', [['Hora', 'Ventas', `Ingresos (${mon})`], ...d.por_hora.map((h: any) => [`${String(h.hora).padStart(2, '0')}:00`, h.ventas, h.ingresos])], [10, 10, 16]);
    hoja('Día de semana', [['Día', 'Días en el período', 'Ventas', `Ingresos (${mon})`, `Promedio por día (${mon})`],
      ...d.por_dia_semana.map((x: any) => [DIAS_SEMANA[x.dia_semana - 1], x.dias, x.ventas, x.ingresos, +this.promedioDow(x).toFixed(2)])], [12, 18, 10, 16, 20]);
    hoja('Categorías', [['Categoría', 'Unidades', `Ingresos (${mon})`, '%'], ...d.por_categoria.map((c: any) => [c.nombre_categoria, c.unidades, c.ingresos, pct(c.ingresos)])], [24, 10, 16, 8]);
    hoja('Productos', [['#', 'Producto', 'Categoría', 'Unidades', `Ingresos (${mon})`, '%'],
      ...d.productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, p.unidades, p.ingresos, pct(p.ingresos)])], [5, 30, 20, 10, 16, 8]);
    hoja('Sin ventas', [['Producto', 'Categoría', 'Stock actual', `Precio (${mon})`, `Valor en stock (${mon})`],
      ...d.sin_ventas.map((p: any) => [p.nombre_producto, p.nombre_categoria, p.stock, p.precio, +(p.stock * p.precio).toFixed(2)])], [30, 20, 12, 12, 18]);
    hoja('Turnos de caja', [['Cajero', 'Sucursal', 'Apertura', 'Cierre', `Fondo inicial (${mon})`, 'Ventas', `Efectivo (${mon})`, `Total (${mon})`, `Esperado en caja (${mon})`, `Contado (${mon})`, `Diferencia (${mon})`],
      ...d.cierres.map((c: any) => [c.cajero, c.nombre_sucursal, fechaHora(c.fecha_hora_apertura), fechaHora(c.fecha_hora_cierre), c.monto_inicial, c.ventas, c.efectivo, c.total,
        c.efectivo_esperado ?? '', c.efectivo_contado ?? '', c.diferencia ?? ''])], [24, 18, 20, 20, 16, 8, 14, 14, 18, 14, 14]);

    XLSX.writeFile(wb, `Informe_${this.nombreArchivo}_${this.fechaInicio}_${this.fechaFin}.xlsx`);
  }

  /** Nombre del negocio apto para archivo: "Pastelería Ricky's" → "Pasteleria_Rickys" */
  private get nombreArchivo(): string {
    return this.ajustes.nombre().normalize('NFD').replace(/\p{M}|'/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Negocio';
  }
}
