
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ReporteService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  // Función para traer los datos del dashboard de una sucursal
  obtenerDatosDashboard(id_sucursal: number): Observable<any> {
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    // TRUCO: Agregamos un "sello de tiempo" al final de la URL
    // Ejemplo: /dashboard/1?hora=17089123456
    const urlSinCache = `${this.apiUrl}/reportes/dashboard/${id_sucursal}?hora=${new Date().getTime()}`;

    return this.http.get(urlSinCache, { headers });
  }
}