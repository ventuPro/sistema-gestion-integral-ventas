import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MesaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  listarMesas(id_sucursal = 1): Observable<any> {
    return this.http.get(`${this.apiUrl}/mesas/sucursal/${id_sucursal}`);
  }

  crearMesa(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/mesas`, datos);
  }

  /** Todos los QR de la sucursal en una sola petición */
  obtenerQRSucursal(id_sucursal: number, base_url: string): Observable<{ id_mesa: number; numero_mesa: number; qr: string; url: string }[]> {
    const params = new HttpParams().set('base_url', base_url);
    return this.http.get<any[]>(`${this.apiUrl}/mesas/sucursal/${id_sucursal}/qr`, { params });
  }

  /** Invalida el QR impreso anterior de la mesa */
  regenerarQR(id_mesa: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/mesas/${id_mesa}/qr/regenerar`, {});
  }

  actualizarEstado(id_mesa: number, estado_mesa: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/mesas/${id_mesa}/estado`, { estado_mesa });
  }

  eliminarMesa(id_mesa: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/mesas/${id_mesa}`);
  }
}