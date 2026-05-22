import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReporteService } from '../../../core/services/reporte.service';
import { ProductoService } from '../../../core/services/producto.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Subscription } from 'rxjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { LucideAngularModule, Filter, ChevronDown, ChevronUp, Layers, X, Check, Sliders, FileDown, FileSpreadsheet, FileText } from 'lucide-angular';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.css'
})
export class ReportesComponent implements OnInit, OnDestroy {
  private reporteService  = inject(ReporteService);
  private productoService = inject(ProductoService);
  private cdr             = inject(ChangeDetectorRef);
  private http            = inject(HttpClient);
  private apiUrl          = environment.apiUrl;

  readonly icons = {
    filter:  Filter,
    sliders: Sliders,
    down:    ChevronDown,
    up:      ChevronUp,
    layers:  Layers,
    close:   X,
    check:   Check,
    excel:   FileSpreadsheet,
    pdf:     FileText,
    download: FileDown
  };

  cargando       = false;
  refrescando    = false;
  datosReporte: any = null;
  periodoActivo: 'hoy' | 'semana' | 'mes' | 'personalizado' = 'mes';

  // FIX: inicializar con fechas válidas
  fechaInicio = '';
  fechaFin    = '';

  // ─── Sucursales ───
  sucursales:      any[] = [];
  sucursalSeleccionada = 1;

  // ─── Filtro categorías ───
  categoriasDisponibles: any[] = [];
  categoriasSeleccionadas = new Set<number>();
  mostrarFiltroCategorias = false;

  // ─── Drill-down por día ───
  diasExpandidos   = new Set<string>();
  desglosePorDia: Record<string, any> = {};
  cargandoDia: Record<string, boolean> = {};

  // ─── Control de requests concurrentes ───
  private reporteSub: Subscription | null = null;
  private debounceTimer: any = null;
  private requestSeq = 0;

  ngOnInit() {
    this.cargarSucursales();
    this.cargarCategorias();
    this.seleccionarPeriodo('mes');
  }

  ngOnDestroy() {
    this.reporteSub?.unsubscribe();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  cargarCategorias() {
    this.productoService.obtenerCategorias().subscribe({
      next: (cats) => { this.categoriasDisponibles = cats || []; this.cdr.detectChanges(); },
      error: () => { this.categoriasDisponibles = []; }
    });
  }

  toggleCategoria(id: number) {
    if (this.categoriasSeleccionadas.has(id)) this.categoriasSeleccionadas.delete(id);
    else this.categoriasSeleccionadas.add(id);
    this.programarRefresco();
  }

  esCategoriaActiva(id: number): boolean {
    return this.categoriasSeleccionadas.has(id);
  }

  limpiarCategorias() {
    if (this.categoriasSeleccionadas.size === 0) return;
    this.categoriasSeleccionadas.clear();
    this.programarRefresco();
  }

  private programarRefresco() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.refrescando = true;
    this.cdr.detectChanges();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.cargarReporte(true);
    }, 180);
  }

  get hayFiltroCategorias(): boolean {
    return this.categoriasSeleccionadas.size > 0;
  }

  get textoFiltroCategorias(): string {
    const n = this.categoriasSeleccionadas.size;
    const total = this.categoriasDisponibles.length;
    if (n === 0) return `Filtrar por categoría (${total})`;
    if (n === 1) {
      const id = [...this.categoriasSeleccionadas][0];
      const cat = this.categoriasDisponibles.find(c => c.id_categoria === id);
      return cat ? cat.nombre_categoria : '1 categoría';
    }
    return `${n} de ${total} categorías`;
  }

  toggleDia(fecha: string) {
    if (this.diasExpandidos.has(fecha)) {
      this.diasExpandidos.delete(fecha);
    } else {
      this.diasExpandidos.add(fecha);
      if (!this.desglosePorDia[fecha]) this.cargarDesgloseDia(fecha);
    }
  }

  estaDiaExpandido(fecha: string): boolean {
    return this.diasExpandidos.has(fecha);
  }

  private cargarDesgloseDia(fecha: string) {
    this.cargandoDia[fecha] = true;
    this.reporteService.obtenerDesgloseDia(this.sucursalSeleccionada, fecha).subscribe({
      next: (d) => {
        this.desglosePorDia[fecha] = d;
        this.cargandoDia[fecha] = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cargandoDia[fecha] = false;
        this.desglosePorDia[fecha] = { desglose: [], total_dia: 0, ventas_dia: 0 };
        this.cdr.detectChanges();
      }
    });
  }

  private fmt(d: Date): string {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  cargarSucursales() {
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    this.http.get<any>(`${this.apiUrl}/usuarios/form-data`, { headers }).subscribe({
      next: (d: any) => { 
        this.sucursales = d.sucursales; 
        this.cdr.detectChanges();
      },
      error: () => console.error('Error al cargar sucursales')
    });
  }

  cambiarSucursal(id: number) {
    this.sucursalSeleccionada = id;
    this.diasExpandidos.clear();
    this.desglosePorDia = {};
    this.cargarReporte();
  }

  seleccionarPeriodo(p: 'hoy' | 'semana' | 'mes' | 'personalizado') {
    this.periodoActivo = p;
    const hoy = new Date();

    if (p === 'hoy') {
      this.fechaInicio = this.fmt(hoy);
      this.fechaFin    = this.fmt(hoy);
      this.cargarReporte();
    } else if (p === 'semana') {
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
      this.fechaInicio = this.fmt(lunes);
      this.fechaFin    = this.fmt(hoy);
      this.cargarReporte();
    } else if (p === 'mes') {
      this.fechaInicio = this.fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      this.fechaFin    = this.fmt(hoy);
      this.cargarReporte();
    }
    // 'personalizado': no carga automáticamente, espera al botón "Generar"
  }

  cargarReporte(silencioso: boolean = false) {
    if (!this.fechaInicio || !this.fechaFin) {
      alert('Selecciona las fechas de inicio y fin.'); return;
    }
    if (this.fechaInicio > this.fechaFin) {
      alert('La fecha de inicio no puede ser mayor a la fecha final.'); return;
    }

    this.reporteSub?.unsubscribe();
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }

    const refresco = silencioso && !!this.datosReporte;
    if (refresco) this.refrescando = true;
    else          this.cargando    = true;

    const cats = [...this.categoriasSeleccionadas];
    const seq  = ++this.requestSeq;

    this.reporteSub = this.reporteService
      .obtenerReportePeriodo(this.sucursalSeleccionada, this.fechaInicio, this.fechaFin, cats)
      .subscribe({
        next: (datos) => {
          if (seq !== this.requestSeq) return;
          this.datosReporte = datos;
          this.cargando     = false;
          this.refrescando  = false;
          this.diasExpandidos.clear();
          this.desglosePorDia = {};
          this.cdr.detectChanges();
        },
        error: () => {
          if (seq !== this.requestSeq) return;
          this.cargando    = false;
          this.refrescando = false;
          this.cdr.detectChanges();
        }
      });
  }

  // ─── Exportar PDF ───
  exportarPDF() {
    if (!this.datosReporte) return;
    const doc = new jsPDF();
    const { resumen, ventas_diarias, por_categoria, top_productos } = this.datosReporte;

    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text("PASTELERÍA RICKY'S", 105, 14, { align: 'center' });
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('Reporte de Ingresos', 105, 22, { align: 'center' });
    doc.setFontSize(9);
    doc.text(`Período: ${this.fechaInicio} al ${this.fechaFin}`, 105, 31, { align: 'center' });
    if (this.hayFiltroCategorias) {
      const nombres = this.categoriasDisponibles
        .filter(c => this.categoriasSeleccionadas.has(c.id_categoria))
        .map(c => c.nombre_categoria)
        .join(', ');
      doc.setFontSize(8);
      doc.text(`Filtrado por categorías: ${nombres}`, 105, 36, { align: 'center' });
    }

    doc.setTextColor(37, 99, 235); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN EJECUTIVO', 14, 52);
    doc.setDrawColor(37, 99, 235); doc.line(14, 54, 196, 54);

    autoTable(doc, {
      startY: 58,
      head: [['Indicador', 'Valor']],
      body: [
        ['Total Ventas',      `${resumen?.total_ventas || 0} ventas`],
        ['Ingresos Totales',  `Bs. ${parseFloat(resumen?.ingresos_totales || 0).toFixed(2)}`],
        ['Ticket Promedio',   `Bs. ${parseFloat(resumen?.ticket_promedio  || 0).toFixed(2)}`],
      ],
      theme: 'striped',
      headStyles:  { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 }
    });

    if (por_categoria?.length > 0) {
      const y1 = (doc as any).lastAutoTable.finalY + 10;
      doc.setTextColor(37, 99, 235); doc.setFont('helvetica', 'bold');
      doc.text('VENTAS POR CATEGORÍA', 14, y1);
      doc.line(14, y1 + 2, 196, y1 + 2);
      // FIX: usar campo correcto "ingresos"
      autoTable(doc, {
        startY: y1 + 6,
        head: [['Categoría', 'Unidades', 'Ingresos']],
        body: por_categoria.map((c: any) => [c.nombre_categoria, c.unidades, `Bs. ${parseFloat(c.ingresos || 0).toFixed(2)}`]),
        theme: 'striped',
        headStyles:  { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });
    }

    if (top_productos?.length > 0) {
      const y2 = (doc as any).lastAutoTable.finalY + 10;
      const yFinal = y2 > 240 ? (doc.addPage(), 20) : y2;
      doc.setTextColor(37, 99, 235); doc.setFont('helvetica', 'bold');
      doc.text('TOP PRODUCTOS MÁS VENDIDOS', 14, yFinal);
      doc.line(14, yFinal + 2, 196, yFinal + 2);
      autoTable(doc, {
        startY: yFinal + 6,
        head: [['#', 'Producto', 'Categoría', 'Unidades', 'Ingresos']],
        body: top_productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, p.unidades, `Bs. ${parseFloat(p.ingresos || 0).toFixed(2)}`]),
        theme: 'striped',
        headStyles:  { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });
    }

    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(150, 150, 150);
      doc.text(`SGIV — Pastelería Ricky's — Pág. ${i}/${total}`, 105, 290, { align: 'center' });
    }
    doc.save(`Reporte_Rickys_${this.fechaInicio}_${this.fechaFin}.pdf`);
  }

  // ─── Exportar Excel ───
  exportarExcel() {
    if (!this.datosReporte) return;
    const wb = XLSX.utils.book_new();
    const { resumen, ventas_diarias, por_categoria, top_productos } = this.datosReporte;

    const filtroNombres = this.hayFiltroCategorias
      ? this.categoriasDisponibles
          .filter(c => this.categoriasSeleccionadas.has(c.id_categoria))
          .map(c => c.nombre_categoria).join(', ')
      : 'Todas';

    const ws1 = XLSX.utils.aoa_to_sheet([
      ["REPORTE DE INGRESOS — PASTELERÍA RICKY'S"],
      [`Período: ${this.fechaInicio} al ${this.fechaFin}`],
      [`Categorías: ${filtroNombres}`],
      [''],
      ['RESUMEN'],
      ['Total Ventas',     resumen?.total_ventas || 0],
      ['Ingresos (Bs.)',   parseFloat(resumen?.ingresos_totales || 0).toFixed(2)],
      ['Ticket Prom (Bs.)',parseFloat(resumen?.ticket_promedio  || 0).toFixed(2)],
    ]);
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

    if (ventas_diarias?.length > 0) {
      const ws2 = XLSX.utils.aoa_to_sheet([
        ['Fecha', 'Ventas', 'Ingresos (Bs.)'],
        ...ventas_diarias.map((d: any) => [d.dia, parseInt(d.ventas), parseFloat(d.ingresos).toFixed(2)])
      ]);
      ws2['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Por Día');
    }

    if (por_categoria?.length > 0) {
      // FIX: usar campo correcto "ingresos"
      const ws3 = XLSX.utils.aoa_to_sheet([
        ['Categoría', 'Unidades', 'Ingresos (Bs.)'],
        ...por_categoria.map((c: any) => [c.nombre_categoria, parseInt(c.unidades || 0), parseFloat(c.ingresos || 0).toFixed(2)])
      ]);
      ws3['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'Por Categoría');
    }

    if (top_productos?.length > 0) {
      const ws4 = XLSX.utils.aoa_to_sheet([
        ['#', 'Producto', 'Categoría', 'Unidades', 'Ingresos (Bs.)'],
        ...top_productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, parseInt(p.unidades || 0), parseFloat(p.ingresos || 0).toFixed(2)])
      ]);
      ws4['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 20 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws4, 'Top Productos');
    }

    XLSX.writeFile(wb, `Reporte_Rickys_${this.fechaInicio}_${this.fechaFin}.xlsx`);
  }

  get resumen() { return this.datosReporte?.resumen || {}; }
}
