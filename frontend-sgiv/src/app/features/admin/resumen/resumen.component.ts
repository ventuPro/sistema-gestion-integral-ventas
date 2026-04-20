import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { CommonModule } from '@angular/common'; 
import { ReporteService } from '../../../core/services/reporte.service';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resumen.component.html',
  styleUrl: './resumen.component.css'
})
export class ResumenComponent implements OnInit {
  private reporteService = inject(ReporteService);
  private cdr = inject(ChangeDetectorRef); 

  resumenDiario: any = { ingresos_totales: 0, total_ventas: 0 };
  alertasStock: any[] = [];
  topProductos: any[] = [];
  cargando: boolean = true;
  graficoBarras: any; 

  ngOnInit() {
    this.cargarDatosReales();
  }

  cargarDatosReales() {
    this.reporteService.obtenerDatosDashboard(1).subscribe({
      next: (datos) => {
        this.resumenDiario = datos.resumen_diario;
        this.topProductos = datos.top_productos;
        this.alertasStock = datos.alertas_stock;
        this.cargando = false;
        this.cdr.detectChanges(); 
        this.renderizarGrafico();
      },
      error: (error) => {
        console.error('Error al cargar el resumen', error);
        this.cargando = false;
        this.cdr.detectChanges(); 
      }
    });
  }

  renderizarGrafico() {
    if (this.graficoBarras) {
      this.graficoBarras.destroy();
    }
    const nombresProductos = this.topProductos.map(p => p.nombre_producto);
    const cantidadesVendidas = this.topProductos.map(p => parseInt(p.total_vendido));

    this.graficoBarras = new Chart('graficoProductos', {
      type: 'bar',
      data: {
        labels: nombresProductos,
        datasets: [{
          label: 'Unidades Vendidas',
          data: cantidadesVendidas,
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }
}