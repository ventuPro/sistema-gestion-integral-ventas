import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProductoService {
  private apiUrl = environment.apiUrl; 

  constructor(private http: HttpClient) { }

  // Función 1: Pedir los productos 
  obtenerInventario(): Observable<any> {
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    const url = `${this.apiUrl}/catalogo/productos?hora=${new Date().getTime()}`;
    return this.http.get(url, { headers });
  }

  // Función 2: ENVIAR un nuevo producto 
  crearProducto(productoData: any): Observable<any> {
    const token = localStorage.getItem('token_sgiv');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    // Aquí enviamos los datos por el método POST
    return this.http.post(`${this.apiUrl}/catalogo/productos`, productoData, { headers });
  }
}