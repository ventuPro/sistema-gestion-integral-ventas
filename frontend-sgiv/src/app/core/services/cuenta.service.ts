import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CuentaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getMesasConCuenta(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/cuentas/mesas/${id_sucursal}`);
  }

  getCuentaActiva(id_mesa: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/cuentas/mesa/${id_mesa}`);
  }

  abrirCuenta(id_mesa: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/abrir`, { id_mesa });
  }

  agregarProducto(id_cuenta: number, datos: { id_producto: number; cantidad: number; precio_unitario: number; nota?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/${id_cuenta}/producto`, datos);
  }

  quitarProducto(id_detalle: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/cuentas/detalle/${id_detalle}`);
  }

  cerrarCuenta(id_cuenta: number, metodo_pago: string, id_sucursal: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/${id_cuenta}/cerrar`, { metodo_pago, id_sucursal });
  }

getProductos(id_sucursal: number = 1): Observable<any[]> {
  return this.http.get<any[]>(
    `${this.apiUrl}/catalogo/productos?id_sucursal=${id_sucursal}`
  );
}

  resetMesa(id_mesa: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/cuentas/reset-mesa`, { id_mesa });
  }

  cancelarSiVacia(id_cuenta: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/cuentas/${id_cuenta}/cancelar-si-vacia`, {});
  }

  getQR(id_mesa: number): Observable<any> {
    // Dirección que abrirá el celular del cliente: la configurada en
    // Mesas → Códigos QR, o la de esta pantalla si no se configuró ninguna.
    let base = window.location.origin;
    try { base = localStorage.getItem('qr_base_url_sgiv') || base; } catch { }

    const url = `${this.apiUrl}/mesas/${id_mesa}/qr?base_url=${encodeURIComponent(base)}`;
    return this.http.get<any>(url);
  }
}