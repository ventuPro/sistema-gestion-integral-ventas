import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  listarUsuarios(): Observable<any>                          { return this.http.get(`${this.apiUrl}/usuarios/`, { headers: this.h() }); }
  obtenerDatosFormulario(): Observable<any>                  { return this.http.get(`${this.apiUrl}/usuarios/formulario`, { headers: this.h() }); }
  crearUsuario(datos: any): Observable<any>                  { return this.http.post(`${this.apiUrl}/usuarios/registro`, datos, { headers: this.h() }); }
  actualizarUsuario(id: number, datos: any): Observable<any> { return this.http.put(`${this.apiUrl}/usuarios/${id}`, datos, { headers: this.h() }); }
  desactivarUsuario(id: number): Observable<any>             { return this.http.delete(`${this.apiUrl}/usuarios/${id}`, { headers: this.h() }); }
  reactivarUsuario(id: number): Observable<any>              { return this.http.patch(`${this.apiUrl}/usuarios/${id}/reactivar`, {}, { headers: this.h() }); }
  cambiarContrasena(id: number, nueva: string): Observable<any> { return this.http.patch(`${this.apiUrl}/usuarios/${id}/contrasena`, { nueva_contrasena: nueva }, { headers: this.h() }); }
}