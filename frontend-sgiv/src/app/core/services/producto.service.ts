import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProductoService {
  private apiUrl = environment.apiUrl; // Esto es http://localhost:3000/api

  constructor(private http: HttpClient) { }

  obtenerInventario(): Observable<any> {
    const token = localStorage.getItem('token_sgiv');
    
    // Si decidiste proteger la ruta en Node, enviamos el token. Si no, no pasa nada, igual lo enviamos por si acaso.
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    // Usamos TU ruta exacta: /catalogo/productos
    // Le agregamos el truco de la hora para evitar la caché terca del navegador
    const url = `${this.apiUrl}/catalogo/productos?hora=${new Date().getTime()}`;

    return this.http.get(url, { headers });
  }
}