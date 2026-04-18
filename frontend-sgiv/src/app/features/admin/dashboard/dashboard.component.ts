// 1. Agrega ChangeDetectorRef aquí arriba en la primera línea
import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common'; 
import { ReporteService } from '../../../core/services/reporte.service';

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
  
  // 2. Inyectamos la herramienta mágica de Angular
  private cdr = inject(ChangeDetectorRef); 

  resumenDiario: any = { ingresos_totales: 0, total_ventas: 0 };
  alertasStock: any[] = [];
  topProductos: any[] = [];
  cargando: boolean = true;

  ngOnInit() {
    this.cargarDatosReales();
  }

  cargarDatosReales() {
    this.reporteService.obtenerDatosDashboard(1).subscribe({
      next: (datos) => {
        console.log('DATOS QUE LLEGARON A ANGULAR:', datos); 
        this.resumenDiario = datos.resumen_diario;
        this.topProductos = datos.top_productos;
        this.alertasStock = datos.alertas_stock;
        this.cargando = false;

        // 3. ¡EL TRUCO MÁGICO! Le ordenamos a Angular que redibuje la pantalla AHORA MISMO
        this.cdr.detectChanges(); 
      },
      error: (error) => {
        console.error('Error al cargar el dashboard', error);
        this.cargando = false;
        this.cdr.detectChanges(); // También lo ponemos aquí por si hay error
      }
    });
  }

  cerrarSesion() {
    localStorage.removeItem('token_sgiv');
    this.router.navigate(['/login']);
  }
}