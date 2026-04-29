import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CajaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  obtenerArqueo(idSucursal: number = 1, fechaInicio?: string, fechaFin?: string): Observable<any> {
    let params = new HttpParams().set('id_sucursal', idSucursal.toString());
    if (fechaInicio) params = params.set('fecha_inicio', fechaInicio);
    if (fechaFin) params = params.set('fecha_fin', fechaFin);
    return this.http.get(`${this.apiUrl}/caja/arqueo`, { headers: this.headers(), params });
  }
}