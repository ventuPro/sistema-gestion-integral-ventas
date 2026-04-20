import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common'; 
import { ReporteService } from '../../../core/services/reporte.service';
// 1. IMPORTAMOS CHART.JS
import { Chart, registerables } from 'chart.js';

// Registramos los componentes de Chart.js
Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private router = inject(Router);
  private reporteService = inject(ReporteService);
  private cdr = inject(ChangeDetectorRef); 

  resumenDiario: any = { ingresos_totales: 0, total_ventas: 0 };
  alertasStock: any[] = [];
  topProductos: any[] = [];
  cargando: boolean = true;
  
  // 2. Variable para nuestro gráfico
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
        
        // 3. ¡AQUÍ DIBUJAMOS EL GRÁFICO UNA VEZ LLEGAN LOS DATOS!
        this.renderizarGrafico();
      },
      error: (error) => {
        console.error('Error al cargar el dashboard', error);
        this.cargando = false;
        this.cdr.detectChanges(); 
      }
    });
  }

  // 4. FUNCIÓN QUE CREA LAS BARRAS
  renderizarGrafico() {
    // Si ya existe un gráfico viejo, lo destruimos para que no se superpongan
    if (this.graficoBarras) {
      this.graficoBarras.destroy();
    }

    // Separamos los nombres y las cantidades de nuestro arreglo de datos
    const nombresProductos = this.topProductos.map(p => p.nombre_producto);
    const cantidadesVendidas = this.topProductos.map(p => parseInt(p.total_vendido));

    // Dibujamos el nuevo gráfico apuntando al 'canvas' del HTML
    this.graficoBarras = new Chart('graficoProductos', {
      type: 'bar', // Tipo de gráfico (barras)
      data: {
        labels: nombresProductos, // Nombres abajo
        datasets: [{
          label: 'Unidades Vendidas',
          data: cantidadesVendidas, // Valores de las barras
          backgroundColor: 'rgba(59, 130, 246, 0.6)', // Azul Tailwind transparente
          borderColor: 'rgba(59, 130, 246, 1)',       // Azul Tailwind sólido
          borderWidth: 1,
          borderRadius: 4 // Bordes redondeados
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true } // Que el gráfico empiece desde el número 0
        }
      }
    });
  }

  cerrarSesion() {
    localStorage.removeItem('token_sgiv');
    this.router.navigate(['/login']);
  }
}