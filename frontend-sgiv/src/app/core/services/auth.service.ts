import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SesionService } from './sesion.service';

// La sesión viaja en una cookie httpOnly que pone el backend: JavaScript no la ve.
// En localStorage solo quedan los datos visibles del usuario (nombre, rol, sucursal).
@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = environment.apiUrl;
  private sesion = inject(SesionService);
  constructor(private http: HttpClient) {
    try { localStorage.removeItem('token_sgiv'); } catch { }   // token de la versión anterior
  }

  obtenerCaptcha(): Observable<{ id_captcha: string; imagen: string }> {
    return this.http.get<{ id_captcha: string; imagen: string }>(`${this.apiUrl}/usuarios/captcha`);
  }

  login(correo_electronico: string, contrasena: string, id_captcha: string, captcha: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login`, { correo_electronico, contrasena, id_captcha, captcha });
  }

  /** Paso 2: código enviado por Telegram */
  verificarCodigo(id_desafio: string, codigo: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login/codigo`, { id_desafio, codigo });
  }

  /** Paso 2 cuando Telegram no respondió: CAPTCHA */
  verificarAlterno(id_desafio: string, id_captcha: string, captcha: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login/alterno`, { id_desafio, id_captcha, captcha });
  }

  reenviarCodigo(id_desafio: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/usuarios/login/reenviar`, { id_desafio });
  }

  estaLogueado(): boolean {
    return !!this.sesion.usuario();
  }

  /** avisarServidor: borra la cookie y deja constancia del cierre (una sesión vencida ya la borró el backend). */
  cerrarSesion(avisarServidor = false): void {
    if (avisarServidor) {
      this.http.post(`${this.apiUrl}/usuarios/logout`, {}).subscribe({ error: () => {} });
    }
    this.sesion.cerrar();
    try { localStorage.removeItem('permisos_sgiv'); } catch { }
  }
}