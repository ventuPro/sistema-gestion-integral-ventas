import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CajaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  // ─── Estado y control de caja ───
  obtenerEstadoCaja(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado/${id_usuario}`, { headers: this.h() });
  }

  habilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/habilitar/${id_usuario}`, {}, { headers: this.h() });
  }

  deshabilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/deshabilitar/${id_usuario}`, {}, { headers: this.h() });
  }

  // ─── Turno y ventas ───
  obtenerArqueo(id_sucursal: number, fecha_inicio?: string, fecha_fin?: string): Observable<any> {
    let params = new HttpParams();
    if (fecha_inicio) params = params.set('fecha_inicio', fecha_inicio);
    if (fecha_fin)    params = params.set('fecha_fin', fecha_fin);
    return this.http.get(`${this.apiUrl}/caja/arqueo/${id_sucursal}`, { headers: this.h(), params });
  }

  abrirTurno(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/turnos/abrir`, datos, { headers: this.h() });
  }

  cierreDiario(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/cierre`, datos, { headers: this.h() });
  }
}