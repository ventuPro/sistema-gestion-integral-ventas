import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReporteService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  obtenerDatosDashboard(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/reportes/dashboard/${id_sucursal}?t=${Date.now()}`);
  }

  obtenerDashboardCompleto(id_sucursal: number, id_categoria?: number | null): Observable<any> {
    let params = new HttpParams();
    if (id_categoria) params = params.set('categoria', id_categoria.toString());
    return this.http.get(`${this.apiUrl}/reportes/dashboard-completo/${id_sucursal}`, { params });
  }

  obtenerReportePeriodo(id_sucursal: number, fechaInicio: string, fechaFin: string, categorias?: number[]): Observable<any> {
    let params = new HttpParams()
      .set('fecha_inicio', fechaInicio)
      .set('fecha_fin', fechaFin);
    if (categorias && categorias.length > 0) {
      params = params.set('categorias', categorias.join(','));
    }
    return this.http.get(`${this.apiUrl}/reportes/periodo/${id_sucursal}`, { params });
  }

  obtenerDesgloseDia(id_sucursal: number, fecha: string): Observable<any> {
    const params = new HttpParams().set('fecha', fecha);
    return this.http.get(`${this.apiUrl}/reportes/dia-detalle/${id_sucursal}`, { params });
  }
}