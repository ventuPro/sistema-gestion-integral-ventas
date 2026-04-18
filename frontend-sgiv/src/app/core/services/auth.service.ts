import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Tomamos la URL base que configuraste en tu archivo environment
  private apiUrl = environment.apiUrl; 

  constructor(private http: HttpClient) { }

  // Función que envía el correo y la contraseña a Node.js
  login(correo_electronico: string, contrasena: string): Observable<any> {
    const url = `${this.apiUrl}/usuarios/login`;
    return this.http.post(url, { correo_electronico, contrasena });
  }

  // Función para guardar el token en el navegador
  guardarToken(token: string): void {
    localStorage.setItem('token_sgiv', token);
  }

  // Función para saber si estamos logueados (revisa si hay token)
  estaLogueado(): boolean {
    return !!localStorage.getItem('token_sgiv');
  }
}