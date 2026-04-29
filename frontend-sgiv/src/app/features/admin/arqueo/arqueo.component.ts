import { Component, inject, OnInit, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CajaService } from '../../../core/services/caja.service';
import { Chart, registerables } from 'chart.js';
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
  private cdr = inject(ChangeDetectorRef);

  cargando = false;
  datosArqueo: any = null;
  ventasFiltradas: any[] = [];

  // Filtros de período
  periodoActivo: 'hoy' | 'semana' | 'mes' | 'personalizado' = 'hoy';
  fechaInicio = '';
  fechaFin = '';

  // Filtro de categoría en tabla
  categoriaFiltroTabla = 'todas';
  categoriasDisponibles: string[] = [];

  // Detalle expandido
  ventaExpandida: number | null = null;

  // Charts
  graficoLinea: any;
  graficoBarras: any;

  ngOnInit() {
    this.seleccionarPeriodo('hoy');
  }

  seleccionarPeriodo(periodo: 'hoy' | 'semana' | 'mes' | 'personalizado') {
    this.periodoActivo = periodo;
    const hoy = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    if (periodo === 'hoy') {
      this.fechaInicio = fmt(hoy);
      this.fechaFin = fmt(hoy);
    } else if (periodo === 'semana') {
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
      this.fechaInicio = fmt(lunes);
      this.fechaFin = fmt(hoy);
    } else if (periodo === 'mes') {
      this.fechaInicio = fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      this.fechaFin = fmt(hoy);
    }

    if (periodo !== 'personalizado') this.cargarArqueo();
  }

  cargarArqueo() {
    if (!this.fechaInicio || !this.fechaFin) return;
    this.cargando = true;
    this.cajaService.obtenerArqueo(1, this.fechaInicio, this.fechaFin).subscribe({
      next: (datos) => {
        this.datosArqueo = datos;
        this.ventasFiltradas = [...datos.ventas];

        // Categorías únicas para filtro
        const cats = new Set<string>();
        datos.ventas.forEach((v: any) => v.detalles?.forEach((d: any) => cats.add(d.categoria)));
        this.categoriasDisponibles = Array.from(cats);

        this.cargando = false;
        this.cdr.detectChanges();
        setTimeout(() => this.renderizarGraficos(), 100);
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  filtrarPorCategoria(categoria: string) {
    this.categoriaFiltroTabla = categoria;
    if (categoria === 'todas') {
      this.ventasFiltradas = [...this.datosArqueo.ventas];
    } else {
      this.ventasFiltradas = this.datosArqueo.ventas.filter((v: any) =>
        v.detalles?.some((d: any) => d.categoria === categoria)
      );
    }
  }

  toggleDetalle(idVenta: number) {
    this.ventaExpandida = this.ventaExpandida === idVenta ? null : idVenta;
  }

  renderizarGraficos() {
    if (!this.datosArqueo) return;

    // Gráfico de línea: ingresos por día
    if (this.graficoLinea) this.graficoLinea.destroy();
    const ctxLinea = document.getElementById('graficoLinea') as HTMLCanvasElement;
    if (ctxLinea && this.datosArqueo.por_dia?.length > 0) {
      this.graficoLinea = new Chart(ctxLinea, {
        type: 'line',
        data: {
          labels: this.datosArqueo.por_dia.map((d: any) => d.fecha),
          datasets: [{
            label: 'Ingresos (Bs.)',
            data: this.datosArqueo.por_dia.map((d: any) => parseFloat(d.ingresos)),
            borderColor: 'rgba(59, 130, 246, 1)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4, fill: true, borderWidth: 2,
            pointBackgroundColor: 'rgba(59, 130, 246, 1)', pointRadius: 4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
      });
    }

    // Gráfico de barras: ventas por categoría
    if (this.graficoBarras) this.graficoBarras.destroy();
    const ctxBarras = document.getElementById('graficoBarras') as HTMLCanvasElement;
    if (ctxBarras && this.datosArqueo.por_categoria?.length > 0) {
      const colores = ['rgba(99, 102, 241, 0.7)', 'rgba(16, 185, 129, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(14, 165, 233, 0.7)'];
      this.graficoBarras = new Chart(ctxBarras, {
        type: 'doughnut',
        data: {
          labels: this.datosArqueo.por_categoria.map((c: any) => c.nombre_categoria),
          datasets: [{
            data: this.datosArqueo.por_categoria.map((c: any) => parseFloat(c.ingresos_categoria)),
            backgroundColor: colores,
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
      });
    }
  }

  imprimirArqueo() { window.print(); }

  get resumen() { return this.datosArqueo?.resumen || {}; }
}