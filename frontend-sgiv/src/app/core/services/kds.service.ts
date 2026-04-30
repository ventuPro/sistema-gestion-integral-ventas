import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class KdsService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  obtenerPedidosKDS(id_sucursal = 1): Observable<any> {
    const params = new HttpParams().set('id_sucursal', id_sucursal.toString());
    return this.http.get(`${this.apiUrl}/kds`, { headers: this.h(), params });
  }

  actualizarItem(id_detalle: number, nuevo_estado: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/kds/item/${id_detalle}`, { nuevo_estado }, { headers: this.h() });
  }
}