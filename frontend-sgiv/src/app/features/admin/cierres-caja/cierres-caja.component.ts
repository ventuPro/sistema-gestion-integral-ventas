import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CajaService } from '../../../core/services/caja.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-cierres-caja',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cierres-caja.component.html'
})
export class CierresCajaComponent implements OnInit {
  private cajaService = inject(CajaService);
  private cdr         = inject(ChangeDetectorRef);
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