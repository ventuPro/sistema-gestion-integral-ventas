import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  obtenerCaptcha(): Observable<{ id_captcha: string; imagen: string }> {
    return this.http.get<{ id_captcha: string; imagen: string }>(`${this.apiUrl}/usuarios/captcha`);
  }

  login(correo_electronico: string, contrasena: string, id_captcha: string, captcha: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login`, { correo_electronico, contrasena, id_captcha, captcha });
  }

  verificarMfa(token_mfa: string, codigo: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login/mfa`, { token_mfa, codigo });
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