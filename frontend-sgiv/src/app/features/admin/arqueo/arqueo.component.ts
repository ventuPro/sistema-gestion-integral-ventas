import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CajaService } from '../../../core/services/caja.service';
import { environment } from '../../../../environments/environment';
import { Chart, registerables } from 'chart.js';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
Chart.register(...registerables);

@Component({
  selector: 'app-arqueo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './arqueo.component.html',
  styleUrl: './arqueo.component.css'
})
export class ArqueoComponent implements OnInit {
  private cajaService = inject(CajaService);
  private cdr         = inject(ChangeDetectorRef);
  private http        = inject(HttpClient);
  private apiUrl      = environment.apiUrl;

  cargando         = false;
  cargandoCierre   = false;
  datosArqueo: any = null;
  ventasFiltradas: any[] = [];

  periodoActivo: 'hoy' | 'personalizado' = 'hoy';
  fechaInicio = '';
  fechaFin    = '';

  categoriaFiltroTabla   = 'todas';
  categoriasDisponibles: string[] = [];
  ventaExpandida: number | null   = null;

  graficoLinea:  any;
  graficoBarras: any;

  ngOnInit() { this.seleccionarPeriodo('hoy'); }

  seleccionarPeriodo(periodo: 'hoy' | 'personalizado') {
    this.periodoActivo = periodo;
    if (periodo === 'hoy') {
      const hoy = new Date().toISOString().split('T')[0];
      this.fechaInicio = hoy;
      this.fechaFin    = hoy;
      this.cargarArqueo();
    }
  }

  cargarArqueo() {
    if (!this.fechaInicio || !this.fechaFin) return;
    this.cargando = true;
    this.cajaService.obtenerArqueo(1, this.fechaInicio, this.fechaFin).subscribe({
      next: (datos) => {
        this.datosArqueo     = datos;
        this.ventasFiltradas = [...datos.ventas];

        const cats = new Set<string>();
        datos.ventas.forEach((v: any) => v.detalles?.forEach((d: any) => cats.add(d.categoria)));
        this.categoriasDisponibles = Array.from(cats);

        this.cargando = false;
        this.cdr.detectChanges();
        setTimeout(() => this.renderizarGraficos(), 150);
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  filtrarPorCategoria(categoria: string) {
    this.categoriaFiltroTabla = categoria;
    this.ventasFiltradas = categoria === 'todas'
      ? [...this.datosArqueo.ventas]
      : this.datosArqueo.ventas.filter((v: any) => v.detalles?.some((d: any) => d.categoria === categoria));
  }

  toggleDetalle(id: number) {
    this.ventaExpandida = this.ventaExpandida === id ? null : id;
  }

  renderizarGraficos() {
    if (!this.datosArqueo) return;
    if (this.graficoLinea)  { this.graficoLinea.destroy();  this.graficoLinea  = null; }
    if (this.graficoBarras) { this.graficoBarras.destroy(); this.graficoBarras = null; }

    const ctxLinea = document.getElementById('graficoLinea') as HTMLCanvasElement;
    if (ctxLinea && this.datosArqueo.por_dia?.length > 0) {
      this.graficoLinea = new Chart(ctxLinea, {
        type: 'line',
        data: {
          labels:   this.datosArqueo.por_dia.map((d: any) => d.fecha),
          datasets: [{
            label: 'Ingresos (Bs.)',
            data:  this.datosArqueo.por_dia.map((d: any) => parseFloat(d.ingresos)),
            borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)',
            tension: 0.4, fill: true, borderWidth: 2, pointRadius: 4,
            pointBackgroundColor: 'rgba(59,130,246,1)'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
      });
    }

    const ctxPie = document.getElementById('graficoBarras') as HTMLCanvasElement;
    if (ctxPie && this.datosArqueo.por_categoria?.length > 0) {
      this.graficoBarras = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
          labels:   this.datosArqueo.por_categoria.map((c: any) => c.nombre_categoria),
          datasets: [{
            data: this.datosArqueo.por_categoria.map((c: any) => parseFloat(c.ingresos_categoria)),
            backgroundColor: ['rgba(99,102,241,0.7)','rgba(16,185,129,0.7)','rgba(245,158,11,0.7)','rgba(239,68,68,0.7)','rgba(14,165,233,0.7)'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
      });
    }
  }

  // ─── Cierre Diario ───
  ejecutarCierreDiario() {
    if (!this.datosArqueo) return;
    if (!confirm('¿Confirmar el CIERRE DIARIO?\n\nSe generará el PDF del reporte y se cerrará el turno activo.')) return;

    this.generarPDFCierreDiario();

    // Llamar al backend para cerrar el turno
    this.cargandoCierre = true;
    const token   = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.post(`${this.apiUrl}/caja/cierre-diario`,
      { id_sucursal: 1, monto_declarado: parseFloat(this.datosArqueo.resumen?.total_efectivo || 0) },
      { headers }
    ).subscribe({
      next: (res: any) => {
        this.cargandoCierre = false;
        alert(`✅ Turno cerrado correctamente.\nPDF generado y descargado.\n${res.mensaje}`);
        this.cargarArqueo();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.cargandoCierre = false;
        const msg = err.error?.error || 'Error al cerrar el turno.';
        alert(`⚠️ PDF generado.\n${msg}`);
        this.cdr.detectChanges();
      }
    });
  }

  generarPDFCierreDiario() {
    const doc = new jsPDF();
    const r   = this.datosArqueo.resumen || {};
    const ventas = this.datosArqueo.ventas || [];
    const fecha  = this.fechaInicio;
    const ahora  = new Date().toLocaleString('es-BO');

    // ─ Encabezado ─
    doc.setFillColor(31, 41, 55);
    doc.rect(0, 0, 210, 42, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text("PASTELERÍA RICKY'S", 105, 14, { align: 'center' });
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('REPORTE DE CIERRE DIARIO', 105, 22, { align: 'center' });
    doc.setFontSize(9);
    doc.text(`Fecha: ${fecha}   |   Generado: ${ahora}`, 105, 30, { align: 'center' });
    doc.text(`Total de ventas: ${r.total_ventas || 0}   |   Ingresos: Bs. ${parseFloat(r.ingresos_totales || 0).toFixed(2)}`, 105, 38, { align: 'center' });

    // ─ Resumen por método de pago ─
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN DE CAJA', 14, 52);
    doc.setDrawColor(59, 130, 246);
    doc.line(14, 54, 196, 54);

    autoTable(doc, {
      startY: 58,
      head: [['Concepto', 'Monto']],
      body: [
        ['Ventas en Efectivo', `Bs. ${parseFloat(r.total_efectivo || 0).toFixed(2)}`],
        ['Ventas por QR',      `Bs. ${parseFloat(r.total_qr      || 0).toFixed(2)}`],
        ['TOTAL INGRESOS',     `Bs. ${parseFloat(r.ingresos_totales || 0).toFixed(2)}`],
        ['Ticket Promedio',    `Bs. ${parseFloat(r.ticket_promedio || 0).toFixed(2)}`],
      ],
      theme: 'striped',
      headStyles:  { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
      bodyStyles:  { fontSize: 10 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 }
    });

    // ─ Detalle de ventas ─
    if (ventas.length > 0) {
      const y1 = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text('DETALLE DE VENTAS', 14, y1);
      doc.line(14, y1 + 2, 196, y1 + 2);

      const rows: any[] = [];
      ventas.forEach((v: any) => {
        rows.push([`#${v.id_venta}`, new Date(v.fecha_venta).toLocaleTimeString('es-BO'), v.cajero, v.metodo_pago, `Bs. ${parseFloat(v.monto_total_venta).toFixed(2)}`]);
        if (v.detalles?.length > 0) {
          v.detalles.forEach((d: any) => {
            rows.push([`  • ${d.nombre_producto}`, d.categoria, `×${d.cantidad}`, `Bs.${parseFloat(d.precio_unitario).toFixed(2)}`, `Bs.${parseFloat(d.subtotal).toFixed(2)}`]);
          });
        }
      });

      autoTable(doc, {
        startY: y1 + 6,
        head: [['ID / Producto', 'Categoría / Hora', 'Cajero / Cant.', 'Método / Precio', 'Total']],
        body: rows,
        theme: 'striped',
        headStyles:  { fillColor: [59, 130, 246], textColor: 255, fontSize: 8 },
        bodyStyles:  { fontSize: 8 },
        columnStyles: { 4: { halign: 'right' } },
        margin: { left: 14, right: 14 }
      });
    }

    // ─ Pie de página ─
    const totalPags = doc.getNumberOfPages();
    for (let i = 1; i <= totalPags; i++) {
      doc.setPage(i);
      doc.setFontSize(7); doc.setTextColor(150, 150, 150);
      doc.text(`SGIV — Pastelería Ricky's — Cierre Diario ${fecha} — Pág. ${i}/${totalPags}`, 105, 290, { align: 'center' });
      doc.setDrawColor(200, 200, 200);
      doc.line(14, 285, 60, 285);
      doc.setFontSize(8); doc.setTextColor(80, 80, 80);
      doc.text('Firma del Cajero', 37, 289, { align: 'center' });
    }

    doc.save(`Cierre_Diario_Rickys_${fecha}.pdf`);
  }

  imprimirArqueo() { window.print(); }
  get resumen() { return this.datosArqueo?.resumen || {}; }
}