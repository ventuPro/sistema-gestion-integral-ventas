import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  // FIX: acepta id_sucursal para filtrar stock correcto
  obtenerInventario(id_sucursal = 1): Observable<any[]> {
    return this.http.get<any[]>(
      `${this.apiUrl}/catalogo/productos?id_sucursal=${id_sucursal}`,
      { headers: this.h() }
    );
  }

  obtenerCategorias(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/catalogo/categorias`, { headers: this.h() });
  }

  crearCategoria(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/categorias`, datos, { headers: this.h() });
  }

  eliminarCategoria(id: number, confirmacion: string): Observable<any> {
    return this.http.request('delete', `${this.apiUrl}/catalogo/categorias/${id}`, {
      headers: this.h(),
      body: { confirmacion }
    });
  }

  // FIX: usa FormData para subir archivos (o JSON si no hay imagen)
  crearProducto(datos: any, archivo?: File): Observable<any> {
    if (archivo) {
      const form = new FormData();
      Object.entries(datos).forEach(([k, v]) => { if (v != null) form.append(k, String(v)); });
      form.append('imagen', archivo);
      return this.http.post(`${this.apiUrl}/catalogo/productos`, form, { headers: new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`) });
    }
    return this.http.post(`${this.apiUrl}/catalogo/productos`, datos, { headers: this.h() });
  }

  actualizarProducto(id: number, datos: any, archivo?: File): Observable<any> {
    if (archivo) {
      const form = new FormData();
      Object.entries(datos).forEach(([k, v]) => { if (v != null) form.append(k, String(v)); });
      form.append('imagen', archivo);
      return this.http.put(`${this.apiUrl}/catalogo/productos/${id}`, form, { headers: new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`) });
    }
    return this.http.put(`${this.apiUrl}/catalogo/productos/${id}`, datos, { headers: this.h() });
  }

  eliminarProducto(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/catalogo/productos/${id}`, { headers: this.h() });
  }

  agregarStock(id_producto: number, cantidad: number, id_sucursal = 1): Observable<any> {
    return this.http.patch(
      `${this.apiUrl}/catalogo/productos/${id_producto}/stock`,
      { cantidad, id_sucursal },
      { headers: this.h() }
    );
  }
}