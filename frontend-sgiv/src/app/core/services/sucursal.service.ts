import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SucursalService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  listarSucursales(): Observable<any> {
    return this.http.get(`${this.apiUrl}/sucursales`, { headers: this.h() });
  }

  crearSucursal(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/sucursales`, datos, { headers: this.h() });
  }
}