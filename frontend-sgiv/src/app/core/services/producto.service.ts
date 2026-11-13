import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ProductoParecido {
  id_producto: number; nombre_producto: string; estado_activo: boolean; sucursales: string; en_sucursal: boolean;
  parecido: number; tipo: 'igual' | 'casi' | 'parecido' | 'contiene';
}

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

  /** Productos activos que la sucursal todavía no tiene */
  faltantes(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/catalogo/productos/faltantes?id_sucursal=${id_sucursal}`);
  }

  /** Productos con nombre parecido (contra duplicados con otro nombre) */
  parecidos(nombre: string, id_sucursal: number, excluir: number | null = null): Observable<ProductoParecido[]> {
    let params = new HttpParams().set('nombre', nombre).set('id_sucursal', id_sucursal);
    if (excluir) params = params.set('excluir', excluir);
    return this.http.get<ProductoParecido[]>(`${this.apiUrl}/catalogo/productos/parecidos`, { params });
  }

  /** El mismo producto en otra sucursal, cada uno con su stock inicial */
  agregarASucursal(id_sucursal: number, productos: { id_producto: number; stock_inicial: number }[]): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/productos/agregar-a-sucursal`, { id_sucursal, productos });
  }

  obtenerCategorias(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/catalogo/categorias`);
  }

  crearCategoria(datos: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/categorias`, datos);
  }

  /** ids en el orden del menú QR */
  ordenarCategorias(ids: number[]): Observable<any[]> {
    return this.http.put<any[]>(`${this.apiUrl}/catalogo/categorias/orden`, { ids });
  }

  eliminarCategoria(id: number, confirmacion: string): Observable<any> {
    return this.http.request('delete', `${this.apiUrl}/catalogo/categorias/${id}`, {
      body: { confirmacion }
    });
  }

  // foto: data URI ya comprimida (core/utils/imagen.ts); sin foto, el backend conserva la actual
  crearProducto(datos: any, foto?: string | null): Observable<any> {
    return this.http.post(`${this.apiUrl}/catalogo/productos`, foto ? { ...datos, url_imagen: foto } : datos);
  }

  actualizarProducto(id: number, datos: any, foto?: string | null): Observable<any> {
    return this.http.put(`${this.apiUrl}/catalogo/productos/${id}`, foto ? { ...datos, url_imagen: foto } : datos);
  }

  desactivarProducto(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/catalogo/productos/${id}`);
  }

  reactivarProducto(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/catalogo/productos/${id}/reactivar`, {});
  }
}