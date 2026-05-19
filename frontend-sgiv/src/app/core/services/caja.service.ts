import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EstadoCajaCompleto {
  estado: 'ABIERTA' | 'CERRADA' | 'SIN_APERTURA';
  caja_habilitada: boolean;
  tiene_turno_hoy: boolean;
  puede_vender:    boolean;
  turno: {
    id_turno: number;
    fecha_hora_apertura: string;
    fecha_hora_cierre?: string;
    monto_inicial: number;
    estado_turno: 'Abierto' | 'Cerrado';
  } | null;
}

@Injectable({ providedIn: 'root' })
export class CajaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  // ── ESTADO COMPLETO (fuente de verdad) ──
  obtenerEstadoCompleto(id_usuario?: number): Observable<EstadoCajaCompleto> {
    const url = id_usuario
      ? `${this.apiUrl}/caja/estado-completo/${id_usuario}`
      : `${this.apiUrl}/caja/estado-completo`;
    return this.http.get<EstadoCajaCompleto>(url, { headers: this.h() });
  }

  // ── LEGACY: estado simple ──
  obtenerEstadoCaja(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado/${id_usuario}`, { headers: this.h() });
  }

  // ── ADMIN: habilitar / cerrar / reabrir caja de un cajero ──
  habilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/habilitar/${id_usuario}`, {}, { headers: this.h() });
  }
  deshabilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/deshabilitar/${id_usuario}`, {}, { headers: this.h() });
  }
  reabrirCaja(id_usuario: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/reabrir/${id_usuario}`, {}, { headers: this.h() });
  }

  // ── ARQUEO / VENTAS ──
  obtenerArqueo(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/arqueo/${id_sucursal}`, { headers: this.h() });
  }
  obtenerVentasHoy(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/caja/ventas-hoy/${id_sucursal}`, { headers: this.h() });
  }
  obtenerCierres(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/caja/cierres`, { headers: this.h() });
  }

  // ── TURNO ──
  obtenerTurnoHoy(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/caja/turno-hoy`, { headers: this.h() });
  }
  abrirTurno(datos: { id_sucursal: number; monto_inicial: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/turnos/abrir`, datos, { headers: this.h() });
  }
  cerrarCaja(datos: { id_sucursal: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/cerrar`, datos, { headers: this.h() });
  }

  obtenerEstadoCajaSucursal(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado-sucursal/${id_sucursal}`, { headers: this.h() });
  }
}
