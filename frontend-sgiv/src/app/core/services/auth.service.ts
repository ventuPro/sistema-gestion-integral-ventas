import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

const CLAVE_TOKEN = 'token_sgiv';

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

  guardarToken(token: string): void {
    localStorage.setItem(CLAVE_TOKEN, token);
  }

  /** Único lugar que lee el token (lo usan el interceptor y el socket) */
  token(): string | null {
    return localStorage.getItem(CLAVE_TOKEN);
  }

  estaLogueado(): boolean {
    return !!this.token();
  }

  /** avisarServidor: deja constancia del cierre en la auditoría (no aplica a sesiones vencidas). */
  cerrarSesion(avisarServidor = false): void {
    // El interceptor agrega el token: la petición sale antes de borrarlo
    if (avisarServidor && this.token()) {
      this.http.post(`${this.apiUrl}/usuarios/logout`, {}).subscribe({ error: () => {} });
    }
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem('usuario_sgiv');
    localStorage.removeItem('permisos_sgiv');
  }
}