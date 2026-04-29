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
  private cdr = inject(ChangeDetectorRef);

  cargando = false;
  datosReporte: any = null;
  periodoActivo: 'hoy' | 'semana' | 'mes' | 'personalizado' = 'mes';
  fechaInicio = '';
  fechaFin = '';
  tipoReporte: 'ingresos' | 'productos' | 'categorias' = 'ingresos';

  ngOnInit() { this.seleccionarPeriodo('mes'); }

  seleccionarPeriodo(p: 'hoy' | 'semana' | 'mes' | 'personalizado') {
    this.periodoActivo = p;
    const hoy = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    if (p === 'hoy') { this.fechaInicio = fmt(hoy); this.fechaFin = fmt(hoy); }
    else if (p === 'semana') { const l = new Date(hoy); l.setDate(hoy.getDate() - hoy.getDay() + 1); this.fechaInicio = fmt(l); this.fechaFin = fmt(hoy); }
    else if (p === 'mes') { this.fechaInicio = fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); this.fechaFin = fmt(hoy); }
    if (p !== 'personalizado') this.cargarReporte();
  }

  cargarReporte() {
    if (!this.fechaInicio || !this.fechaFin) return;
    this.cargando = true;
    this.reporteService.obtenerReportePeriodo(1, this.fechaInicio, this.fechaFin).subscribe({
      next: (datos) => { this.datosReporte = datos; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  // ─── Exportar PDF ───
  exportarPDF() {
    if (!this.datosReporte) return;
    const doc = new jsPDF();
    const { resumen, ventas_diarias, por_categoria, top_productos } = this.datosReporte;
    const hoy = new Date().toLocaleDateString('es-BO');

    // Encabezado
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('PASTELERÍA RICKY\'S', 105, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Gestión de Ventas e Inventario', 105, 23, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Reporte de Ingresos — ${this.fechaInicio} al ${this.fechaFin}`, 105, 31, { align: 'center' });

    // Fecha de generación
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    doc.text(`Generado el: ${hoy}`, 200, 44, { align: 'right' });

    // Resumen ejecutivo
    doc.setTextColor(37, 99, 235);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN EJECUTIVO', 14, 52);
    doc.setDrawColor(37, 99, 235);
    doc.line(14, 54, 196, 54);

    const r = resumen || {};
    autoTable(doc, {
      startY: 58,
      head: [['Indicador', 'Valor']],
      body: [
        ['Total de Ventas Realizadas', `${r.total_ventas || 0} ventas`],
        ['Ingresos Totales', `Bs. ${parseFloat(r.ingresos_totales || 0).toFixed(2)}`],
        ['Ticket Promedio por Venta', `Bs. ${parseFloat(r.ticket_promedio || 0).toFixed(2)}`],
      ],
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 60, halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 }
    });

    // Ventas por categoría
    if (por_categoria?.length > 0) {
      const y1 = (doc as any).lastAutoTable.finalY + 10;
      doc.setTextColor(37, 99, 235);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('VENTAS POR CATEGORÍA', 14, y1);
      doc.line(14, y1 + 2, 196, y1 + 2);
      autoTable(doc, {
        startY: y1 + 6,
        head: [['Categoría', 'Unidades Vendidas', 'Ingresos (Bs.)']],
        body: por_categoria.map((c: any) => [c.nombre_categoria, c.unidades, `Bs. ${parseFloat(c.ingresos).toFixed(2)}`]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 10 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });
    }

    // Top productos
    if (top_productos?.length > 0) {
      const y2 = (doc as any).lastAutoTable.finalY + 10;
      if (y2 > 240) doc.addPage();
      const yFinal = y2 > 240 ? 20 : y2;
      doc.setTextColor(37, 99, 235);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('TOP PRODUCTOS MÁS VENDIDOS', 14, yFinal);
      doc.line(14, yFinal + 2, 196, yFinal + 2);
      autoTable(doc, {
        startY: yFinal + 6,
        head: [['#', 'Producto', 'Categoría', 'Unidades', 'Ingresos (Bs.)']],
        body: top_productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, p.unidades, `Bs. ${parseFloat(p.ingresos).toFixed(2)}`]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });
    }

    // Pie de página en todas las páginas
    const totalPags = doc.getNumberOfPages();
    for (let i = 1; i <= totalPags; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Sistema SGIV — Pastelería Ricky's — Página ${i} de ${totalPags}`, 105, 290, { align: 'center' });
    }

    doc.save(`Reporte_Ricky's_${this.fechaInicio}_${this.fechaFin}.pdf`);
  }

  // ─── Exportar Excel ───
  exportarExcel() {
    if (!this.datosReporte) return;
    const wb = XLSX.utils.book_new();
    const { resumen, ventas_diarias, por_categoria, top_productos } = this.datosReporte;

    // Hoja 1: Resumen
    const resumenData = [
      ['REPORTE DE INGRESOS — PASTELERÍA RICKY\'S'],
      [`Período: ${this.fechaInicio} al ${this.fechaFin}`],
      [''],
      ['RESUMEN EJECUTIVO'],
      ['Total Ventas', resumen?.total_ventas || 0],
      ['Ingresos Totales (Bs.)', parseFloat(resumen?.ingresos_totales || 0).toFixed(2)],
      ['Ticket Promedio (Bs.)', parseFloat(resumen?.ticket_promedio || 0).toFixed(2)],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(resumenData);
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

    // Hoja 2: Ventas por día
    if (ventas_diarias?.length > 0) {
      const diasData = [
        ['Fecha', 'Número de Ventas', 'Ingresos (Bs.)'],
        ...ventas_diarias.map((d: any) => [d.dia, parseInt(d.ventas), parseFloat(d.ingresos).toFixed(2)])
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(diasData);
      ws2['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Ventas por Día');
    }

    // Hoja 3: Por categoría
    if (por_categoria?.length > 0) {
      const catData = [
        ['Categoría', 'Unidades Vendidas', 'Ingresos (Bs.)'],
        ...por_categoria.map((c: any) => [c.nombre_categoria, parseInt(c.unidades), parseFloat(c.ingresos).toFixed(2)])
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(catData);
      ws3['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'Por Categoría');
    }

    // Hoja 4: Top productos
    if (top_productos?.length > 0) {
      const prodData = [
        ['#', 'Producto', 'Categoría', 'Unidades', 'Ingresos (Bs.)'],
        ...top_productos.map((p: any, i: number) => [i + 1, p.nombre_producto, p.nombre_categoria, parseInt(p.unidades), parseFloat(p.ingresos).toFixed(2)])
      ];
      const ws4 = XLSX.utils.aoa_to_sheet(prodData);
      ws4['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws4, 'Top Productos');
    }

    XLSX.writeFile(wb, `Reporte_Rickys_${this.fechaInicio}_${this.fechaFin}.xlsx`);
  }

  get resumen() { return this.datosReporte?.resumen || {}; }
}