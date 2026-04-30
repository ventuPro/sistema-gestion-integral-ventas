import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  login(correo_electronico: string, contrasena: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login`, { correo_electronico, contrasena });
  }

  guardarToken(token: string): void {
    localStorage.setItem('token_sgiv', token);
  }

  estaLogueado(): boolean {
    return !!localStorage.getItem('token_sgiv');
  }

  cerrarSesion(): void {
    localStorage.removeItem('token_sgiv');
    localStorage.removeItem('usuario_sgiv');
    localStorage.removeItem('permisos_sgiv');
  }
}