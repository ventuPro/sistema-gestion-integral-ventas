import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  obtenerInventario(id_sucursal = 1, incluirInactivos = false): Observable<any[]> {
    const inc = incluirInactivos ? '&incluir_inactivos=true' : '';
    return this.http.get<any[]>(
      `${this.apiUrl}/catalogo/productos?id_sucursal=${id_sucursal}${inc}`
    );
  }

  obtenerCategorias(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/catalogo/categorias`);
  }

  crearCategoria(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/categorias`, datos);
  }

  eliminarCategoria(id: number, confirmacion: string): Observable<any> {
    return this.http.request('delete', `${this.apiUrl}/catalogo/categorias/${id}`, {
      body: { confirmacion }
    });
  }

  // El backend no procesa multipart: la imagen viaja como data URI (base64) en el JSON
  // y el servidor la guarda en /uploads/productos.
  crearProducto(datos: any, archivo?: File): Observable<any> {
    return this.conImagen(datos, archivo).pipe(
      switchMap(body => this.http.post(`${this.apiUrl}/catalogo/productos`, body))
    );
  }

  actualizarProducto(id: number, datos: any, archivo?: File): Observable<any> {
    return this.conImagen(datos, archivo).pipe(
      switchMap(body => this.http.put(`${this.apiUrl}/catalogo/productos/${id}`, body))
    );
  }

  private conImagen(datos: any, archivo?: File): Observable<any> {
    if (!archivo) return of(datos);
    return new Observable<any>(sub => {
      const reader = new FileReader();
      reader.onload  = () => { sub.next({ ...datos, url_imagen: reader.result as string }); sub.complete(); };
      reader.onerror = () => sub.error(reader.error);
      reader.readAsDataURL(archivo);
    });
  }

  desactivarProducto(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/catalogo/productos/${id}`);
  }

  reactivarProducto(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/catalogo/productos/${id}/reactivar`, {});
  }
}