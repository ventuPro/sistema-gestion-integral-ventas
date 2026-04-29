import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  obtenerInventario(): Observable<any> {
    return this.http.get(`${this.apiUrl}/catalogo/productos?t=${Date.now()}`, { headers: this.headers() });
  }

  crearProducto(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/productos`, data, { headers: this.headers() });
  }

  actualizarProducto(id: number, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/catalogo/productos/${id}`, data, { headers: this.headers() });
  }

  eliminarProducto(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/catalogo/productos/${id}`, { headers: this.headers() });
  }

  ingresarStock(id: number, cantidad: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/catalogo/productos/${id}/stock`, { cantidad }, { headers: this.headers() });
  }

  obtenerCategorias(): Observable<any> {
    return this.http.get(`${this.apiUrl}/catalogo/categorias`, { headers: this.headers() });
  }

  // NUEVO
  crearCategoria(nombre_categoria: string, descripcion_categoria: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/categorias`, { nombre_categoria, descripcion_categoria }, { headers: this.headers() });
  }
}