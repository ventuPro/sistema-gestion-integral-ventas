import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CajaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  obtenerEstadoCaja(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado/${id_usuario}`, { headers: this.h() });
  }

  habilitarCaja(id_usuario: number): Observable<any> {
  return this.http.patch(
    `${this.apiUrl}/caja/habilitar/${id_usuario}`,
    {},
    { headers: this.h() }
  );
}

deshabilitarCaja(id_usuario: number): Observable<any> {
  return this.http.patch(
    `${this.apiUrl}/caja/deshabilitar/${id_usuario}`,
    {},
    { headers: this.h() }
  );
}

  // FIX: sin parámetros de fecha, siempre es HOY
  obtenerArqueo(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/arqueo/${id_sucursal}`, { headers: this.h() });
  }

  // FIX: endpoint correcto para cerrar caja
  cerrarCaja(datos: { id_sucursal: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/cerrar`, datos, { headers: this.h() });
  }

  obtenerVentasHoy(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/caja/ventas-hoy/${id_sucursal}`, { headers: this.h() });
  }

  obtenerCierres(): Observable<any[]> {
  return this.http.get<any[]>(`${this.apiUrl}/caja/cierres`, { headers: this.h() });
}

obtenerTurnoHoy(): Observable<any> {
  return this.http.get<any>(`${this.apiUrl}/caja/turno-hoy`, { headers: this.h() });
}

abrirTurno(datos: { id_sucursal: number; monto_inicial: number }): Observable<any> {
  return this.http.post(`${this.apiUrl}/caja/turnos/abrir`, datos, { headers: this.h() });
}

obtenerEstadoCajaSucursal(id_sucursal: number): Observable<any> {
  return this.http.get(
    `${this.apiUrl}/caja/estado-sucursal/${id_sucursal}`,
    { headers: this.h() }
  );
}

}