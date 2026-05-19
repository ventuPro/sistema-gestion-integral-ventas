import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ReporteService } from '../../../core/services/reporte.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { CajaService } from '../../../core/services/caja.service';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resumen.component.html',
  styleUrl: './resumen.component.css'
})
export class ResumenComponent implements OnInit, OnDestroy {
  private reporteService  = inject(ReporteService);
  private sucursalService = inject(SucursalService);
  private cajaService     = inject(CajaService);
  private cdr             = inject(ChangeDetectorRef);
  private router          = inject(Router);

  cargando       = true;
  esAdmin        = false;
  datosAdmin: any = null;

  // Sucursales
  sucursales:        any[]   = [];
  sucursalActual:    number  = 1;
  mostrarModalSucursal = false;
  nuevaSucursal    = { nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' };
  errorSucursal    = '';
  cargandoSucursal = false;
  cajasAbiertas:     Record<number, boolean> = {};
  cajerosTurnos:     Record<number, number>  = {};

  // Categorías para filtro de gráfico de productos
  listaCategorias:      any[]        = [];
  categoriaFiltroChart: number | null = null;

  // Charts
  graficoPie:      any;
  graficoBarras:   any;
  graficoProductos: any;

  // Intervalo de refresco automático
  private refreshInterval: any;

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      const u = JSON.parse(raw);
      this.esAdmin       = u.id_rol === 1;
      this.sucursalActual = u.id_sucursal || 1;
    }

    if (!this.esAdmin) {
      this.router.navigate(['/dashboard/punto-venta']);
      return;
    }

    this.cargarSucursales();
    this.cargarCategorias();
    this.cargarDatos();
    this.cargarEstadoCajas();

    // Refresco automático cada 30s (incluye estado de cajas)
    this.refreshInterval = setInterval(() => {
      this.cargarDatos();
      this.cargarEstadoCajas();
    }, 30000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.destruirGraficos();
  }

  cargarSucursales() {
    this.sucursalService.listarSucursales().subscribe({
      next: (s) => {
        this.sucursales = s;
        // Una vez cargadas las sucursales, consultar el estado de caja de cada una
        this.cargarEstadoCajas();
        this.cdr.detectChanges();
      }
    });
  }

  cargarCategorias() {
    // Reutilizamos el endpoint del backend
    const token = localStorage.getItem('token_sgiv');
    const url   = (window as any).__env?.apiUrl || 'http://localhost:3000/api';
    // Usamos fetch simple para no añadir dependencias
    fetch(`http://localhost:3000/api/catalogo/categorias`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { this.listaCategorias = data; this.cdr.detectChanges(); })
      .catch(() => {});
  }

  cargarDatos() {
    this.reporteService.obtenerDashboardCompleto(this.sucursalActual, this.categoriaFiltroChart).subscribe({
      next: (datos) => {
        this.datosAdmin = datos;
        this.cargando   = false;
        this.cdr.detectChanges();
        setTimeout(() => this.renderizarGraficos(), 150);
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cargarEstadoCajas() {
    // Garantizar que SIEMPRE pidamos al menos el estado de la sucursal actual,
    // aunque la lista de sucursales aún no haya cargado.
    const lista = this.esAdmin && this.sucursales.length > 0
      ? this.sucursales
      : [{ id_sucursal: this.sucursalActual }];

    lista.forEach((s: any) => {
      if (!s?.id_sucursal) return;
      this.cajaService.obtenerEstadoCajaSucursal(s.id_sucursal).subscribe({
        next: (r: any) => {
          this.cajasAbiertas[s.id_sucursal] = r?.hay_caja_abierta === true;
          this.cajerosTurnos[s.id_sucursal] = Number(r?.cajeros_con_turno) || 0;
          this.cdr.detectChanges();
        },
        error: () => {
          this.cajasAbiertas[s.id_sucursal] = false;
          this.cajerosTurnos[s.id_sucursal] = 0;
          this.cdr.detectChanges();
        }
      });
    });
  }

  cambiarSucursal(id_sucursal: number) {
    this.sucursalActual = id_sucursal;
    this.cargando = true;
    this.destruirGraficos();
    this.cargarDatos();
    this.cargarEstadoCajas();
  }

  filtrarCategoria(idCat: number | null) {
    this.categoriaFiltroChart = idCat;
    this.cargarDatos();
  }

  destruirGraficos() {
    if (this.graficoPie)       { this.graficoPie.destroy();       this.graficoPie = null; }
    if (this.graficoBarras)    { this.graficoBarras.destroy();    this.graficoBarras = null; }
    if (this.graficoProductos) { this.graficoProductos.destroy(); this.graficoProductos = null; }
  }

  renderizarGraficos() {
    if (!this.datosAdmin) return;
    this.destruirGraficos();

    // 1. Pie: métodos de pago
    const ctxPie = document.getElementById('graficoPie') as HTMLCanvasElement;
    if (ctxPie && this.datosAdmin.metodos_pago?.length > 0) {
      const labels = this.datosAdmin.metodos_pago.map((m: any) => m.metodo_pago);
      const data   = this.datosAdmin.metodos_pago.map((m: any) => parseFloat(m.total));
      this.graficoPie = new Chart(ctxPie, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: ['rgba(16, 185, 129, 0.8)', 'rgba(139, 92, 246, 0.8)', 'rgba(59, 130, 246, 0.8)'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
        }
      });
    }

    // 2. Barras: ingresos últimos 7 días
    const ctxBarras = document.getElementById('graficoBarras') as HTMLCanvasElement;
    if (ctxBarras && this.datosAdmin.ventas_por_dia?.length > 0) {
      this.graficoBarras = new Chart(ctxBarras, {
        type: 'bar',
        data: {
          labels: this.datosAdmin.ventas_por_dia.map((d: any) => d.fecha),
          datasets: [{
            label: 'Ingresos Bs.',
            data:  this.datosAdmin.ventas_por_dia.map((d: any) => parseFloat(d.ingresos)),
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor:     'rgba(59, 130, 246, 1)',
            borderWidth: 1, borderRadius: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    }

    // 3. Barras: top productos
    const ctxProd = document.getElementById('graficoProductos') as HTMLCanvasElement;
    if (ctxProd && this.datosAdmin.top_productos?.length > 0) {
      this.graficoProductos = new Chart(ctxProd, {
        type: 'bar',
        data: {
          labels: this.datosAdmin.top_productos.map((p: any) => p.nombre_producto),
          datasets: [{
            label: 'Unidades vendidas',
            data:  this.datosAdmin.top_productos.map((p: any) => p.total_vendido),
            backgroundColor: 'rgba(16, 185, 129, 0.7)',
            borderColor:     'rgba(16, 185, 129, 1)',
            borderWidth: 1, borderRadius: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          scales: { x: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    }
  }

  // ─── Modal sucursal ───
  abrirModalSucursal() {
    this.nuevaSucursal = { nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' };
    this.errorSucursal = '';
    this.mostrarModalSucursal = true;
  }

  cerrarModalSucursal() { this.mostrarModalSucursal = false; }

  guardarSucursal() {
    if (!this.nuevaSucursal.nombre_sucursal.trim()) {
      this.errorSucursal = 'El nombre es obligatorio.'; return;
    }
    this.cargandoSucursal = true;
    this.sucursalService.crearSucursal(this.nuevaSucursal).subscribe({
      next: () => {
        this.cargandoSucursal = false;
        this.cerrarModalSucursal();
        this.cargarSucursales();
      },
      error: () => { this.errorSucursal = 'Error al crear la sucursal.'; this.cargandoSucursal = false; }
    });
  }

  get resumen()     { return this.datosAdmin?.resumen_hoy   || {}; }
  get turno()       { return this.datosAdmin?.turno_actual  || null; }
  get totalEfectivo() { return parseFloat(this.resumen.total_efectivo || 0); }
  get totalQr()       { return parseFloat(this.resumen.total_qr       || 0); }
  get totalGeneral()  { return parseFloat(this.resumen.ingresos_totales || 0); }
}