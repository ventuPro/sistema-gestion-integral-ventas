import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReporteService } from '../../../core/services/reporte.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.css'
})
export class ReportesComponent implements OnInit {
  private reporteService = inject(ReporteService);
  private cdr            = inject(ChangeDetectorRef);

  cargando       = false;
  datosReporte: any = null;
  periodoActivo: 'hoy' | 'semana' | 'mes' | 'personalizado' = 'mes';

  // FIX: inicializar con fechas válidas
  fechaInicio = '';
  fechaFin    = '';

  ngOnInit() { this.seleccionarPeriodo('mes'); }

  private fmt(d: Date): string {
    return d.toISOString().split('T')[0];
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

  cargarReporte() {
    if (!this.fechaInicio || !this.fechaFin) {
      alert('Selecciona las fechas de inicio y fin.'); return;
    }
    if (this.fechaInicio > this.fechaFin) {
      alert('La fecha de inicio no puede ser mayor a la fecha final.'); return;
    }
    this.cargando = true;
    this.reporteService.obtenerReportePeriodo(1, this.fechaInicio, this.fechaFin).subscribe({
      next:  (datos) => { this.datosReporte = datos; this.cargando = false; this.cdr.detectChanges(); },
      error: ()      => { this.cargando = false; this.cdr.detectChanges(); }
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

    const ws1 = XLSX.utils.aoa_to_sheet([
      ["REPORTE DE INGRESOS — PASTELERÍA RICKY'S"],
      [`Período: ${this.fechaInicio} al ${this.fechaFin}`],
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