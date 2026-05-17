import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MesaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  listarMesas(id_sucursal = 1): Observable<any> {
    return this.http.get(`${this.apiUrl}/mesas/sucursal/${id_sucursal}`, { headers: this.h() });
  }

  crearMesa(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/mesas`, datos, { headers: this.h() });
  }

  obtenerQR(id_mesa: number): Observable<any> {
    const params = new HttpParams().set('base_url', window.location.origin);
    return this.http.get(`${this.apiUrl}/mesas/${id_mesa}/qr`, { headers: this.h(), params });
  }

  actualizarEstado(id_mesa: number, estado_mesa: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/mesas/${id_mesa}/estado`, { estado_mesa }, { headers: this.h() });
  }

  listarPendientesCajero(id_sucursal = 1): Observable<any> {
    return this.http.get(`${this.apiUrl}/pedidos/pendientes/${id_sucursal}`, { headers: this.h() });
  }

  aprobarPedido(id_pedido: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/pedidos/${id_pedido}/aprobar`, {}, { headers: this.h() });
  }

  rechazarPedido(id_pedido: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/pedidos/${id_pedido}/rechazar`, {}, { headers: this.h() });
  }

  eliminarMesa(id_mesa: number): Observable<any> {
  return this.http.delete(`${this.apiUrl}/mesas/${id_mesa}`, { headers: this.h() });
}
}