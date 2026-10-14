import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SucursalService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  listarSucursales(): Observable<any> {
    return this.http.get(`${this.apiUrl}/sucursales`);
  }

  crearSucursal(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/sucursales`, datos);
  }

  actualizarSucursal(id: number, datos: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/sucursales/${id}`, datos);
  }

  cambiarEstado(id: number, estado_activo: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/sucursales/${id}/estado`, { estado_activo });
  }
}