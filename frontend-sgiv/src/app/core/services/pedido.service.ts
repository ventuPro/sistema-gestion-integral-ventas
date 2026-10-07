import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ─── Pedidos del menú QR (bandeja del cajero) ───
@Injectable({ providedIn: 'root' })
export class PedidoService {
  private apiUrl = `${environment.apiUrl}/pedidos`;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  /** Pedidos por confirmar y por entregar de la sucursal del usuario */
  bandeja(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/bandeja`, { headers: this.h() });
  }

  /** cantidad 0 = quitar el producto del pedido */
  ajustarCantidad(id_pedido: number, id_detalle: number, cantidad: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id_pedido}/detalle/${id_detalle}`, { cantidad }, { headers: this.h() });
  }

  confirmar(id_pedido: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id_pedido}/confirmar`, {}, { headers: this.h() });
  }

  rechazar(id_pedido: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id_pedido}/rechazar`, {}, { headers: this.h() });
  }

  marcarEntregado(id_pedido: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id_pedido}/entregado`, {}, { headers: this.h() });
  }
}
