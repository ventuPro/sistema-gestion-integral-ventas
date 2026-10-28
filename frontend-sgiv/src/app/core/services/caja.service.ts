import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EstadoCajaCompleto {
  estado: 'ABIERTA' | 'CERRADA' | 'SIN_APERTURA';
  caja_habilitada: boolean;
  tiene_turno_hoy: boolean;
  puede_vender:    boolean;
  /** Su turno anterior lo cerró el sistema a las 00:00 */
  cierre_sistema?: { id_turno: number; fecha_hora_apertura: string; fecha_hora_cierre: string } | null;
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

  // ── ESTADO COMPLETO (fuente de verdad) ──
  obtenerEstadoCompleto(id_usuario?: number): Observable<EstadoCajaCompleto> {
    const url = id_usuario
      ? `${this.apiUrl}/caja/estado-completo/${id_usuario}`
      : `${this.apiUrl}/caja/estado-completo`;
    return this.http.get<EstadoCajaCompleto>(url);
  }

  // ── LEGACY: estado simple ──
  obtenerEstadoCaja(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado/${id_usuario}`);
  }

  // ── ADMIN: habilitar / cerrar / reabrir caja de un cajero ──
  habilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/habilitar/${id_usuario}`, {});
  }
  deshabilitarCaja(id_usuario: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/caja/deshabilitar/${id_usuario}`, {});
  }
  reabrirCaja(id_usuario: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/reabrir/${id_usuario}`, {});
  }

  // ── ARQUEO / VENTAS ──
  obtenerArqueo(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/arqueo/${id_sucursal}`);
  }
  /** Comprobante de una venta ya registrada, para reimprimirlo */
  obtenerComprobante(id_venta: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/ventas/${id_venta}/comprobante`);
  }
  obtenerVentasHoy(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/caja/ventas-hoy/${id_sucursal}`);
  }
  obtenerCierres(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/caja/cierres`);
  }

  // ── TURNO ──
  obtenerTurnoHoy(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/caja/turno-hoy`);
  }
  abrirTurno(datos: { id_sucursal: number; monto_inicial: number }): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/turnos/abrir`, datos);
  }
  cerrarCaja(datos: { id_sucursal: number; efectivo_contado?: number | null }): Observable<any> {
    return this.http.post(`${this.apiUrl}/caja/cerrar`, datos);
  }

  obtenerEstadoCajaSucursal(id_sucursal: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/caja/estado-sucursal/${id_sucursal}`);
  }
}
