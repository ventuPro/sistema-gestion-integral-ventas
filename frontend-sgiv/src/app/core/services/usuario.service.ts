import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  listarUsuarios(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/usuarios`);
  }

  obtenerDatosFormulario(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/usuarios/form-data`);
  }

  crearUsuario(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/registro`, datos);
  }

  actualizarUsuario(id: number, datos: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/usuarios/${id}`, datos);
  }

  desactivarUsuario(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/usuarios/${id}/desactivar`, {});
  }

  reactivarUsuario(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/usuarios/${id}/reactivar`, {});
  }

  cambiarContrasena(id: number, nueva_contrasena: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/usuarios/${id}/contrasena`, { nueva_contrasena });
  }
}