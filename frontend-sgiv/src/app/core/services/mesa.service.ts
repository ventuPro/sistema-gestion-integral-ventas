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

  /** base_url: dirección del sistema que abrirá el celular del cliente al escanear */
  obtenerQR(id_mesa: number, base_url = window.location.origin): Observable<any> {
    const params = new HttpParams().set('base_url', base_url);
    return this.http.get(`${this.apiUrl}/mesas/${id_mesa}/qr`, { headers: this.h(), params });
  }

  /** Invalida el QR impreso anterior de la mesa */
  regenerarQR(id_mesa: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/mesas/${id_mesa}/qr/regenerar`, {}, { headers: this.h() });
  }

  actualizarEstado(id_mesa: number, estado_mesa: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/mesas/${id_mesa}/estado`, { estado_mesa }, { headers: this.h() });
  }

  eliminarMesa(id_mesa: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/mesas/${id_mesa}`, { headers: this.h() });
  }
}