import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CajaService } from '../../../core/services/caja.service';
import { environment } from '../../../../environments/environment';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';

@Component({
  selector: 'app-cierres-caja',
  standalone: true,
  imports: [CommonModule, SelectorSucursalComponent],
  templateUrl: './cierres-caja.component.html'
})
export class CierresCajaComponent implements OnInit {
  private cajaService = inject(CajaService);
  private cdr         = inject(ChangeDetectorRef);
  readonly moneda      = inject(AjustesService).moneda;
  private http        = inject(HttpClient);
  private apiUrl      = environment.apiUrl;

  cierres:           any[] = [];
  cierresFiltrados:  any[] = [];
  sucursales:        any[] = [];
  sucursalFiltro:    any   = null;  // null = todas
  cargando           = true;

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  ngOnInit() {
    this.cargarSucursales();
    this.cargar();
  }

  cargarSucursales() {
    this.http.get<any[]>(`${this.apiUrl}/sucursales`, { headers: this.h() }).subscribe({
      next: (s) => { this.sucursales = s; this.cdr.detectChanges(); }
    });
  }

  cargar() {
    this.cargando = true;
    this.cajaService.obtenerCierres().subscribe({
      next: (data) => {
        this.cierres = data;
        this.aplicarFiltro();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  seleccionarSucursal(suc: any | null) {
    this.sucursalFiltro = suc;
    this.aplicarFiltro();
  }

  cambiarSucursal(id: number | null) {
    this.seleccionarSucursal(this.sucursales.find(s => s.id_sucursal === id) || null);
  }

  aplicarFiltro() {
    if (!this.sucursalFiltro) {
      this.cierresFiltrados = [...this.cierres];
    } else {
      this.cierresFiltrados = this.cierres.filter(
        c => c.nombre_sucursal === this.sucursalFiltro.nombre_sucursal
      );
    }
    this.cdr.detectChanges();
  }

  getTotalGeneral(): number {
    return this.cierresFiltrados.reduce((s, c) => s + Number(c.total_recaudado), 0);
  }
}