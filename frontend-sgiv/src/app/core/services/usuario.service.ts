import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  private getHeaders(): HttpHeaders {
    const token = localStorage.getItem('token_sgiv');
    return new HttpHeaders().set('Authorization', `Bearer ${token}`);
  }

  // Obtener todos los usuarios
  listarUsuarios(): Observable<any> {
    return this.http.get(`${this.apiUrl}/usuarios/`, { headers: this.getHeaders() });
  }

  // Obtener datos para los dropdowns (roles y sucursales)
  obtenerDatosFormulario(): Observable<any> {
    return this.http.get(`${this.apiUrl}/usuarios/formulario`, { headers: this.getHeaders() });
  }

  // Crear un nuevo usuario (usa el endpoint de registro)
  crearUsuario(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/registro`, datos, { headers: this.getHeaders() });
  }

  // Actualizar usuario (sin contraseña)
  actualizarUsuario(id: number, datos: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/usuarios/${id}`, datos, { headers: this.getHeaders() });
  }

  // Desactivar usuario
  desactivarUsuario(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/usuarios/${id}`, { headers: this.getHeaders() });
  }
}