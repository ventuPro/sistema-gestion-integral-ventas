import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CuentaService {
  private apiUrl = environment.apiUrl;
  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  getMesasConCuenta(id_sucursal: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/cuentas/mesas/${id_sucursal}`, { headers: this.h() });
  }

  getCuentaActiva(id_mesa: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/cuentas/mesa/${id_mesa}`, { headers: this.h() });
  }

  abrirCuenta(id_mesa: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/abrir`, { id_mesa }, { headers: this.h() });
  }

  agregarProducto(id_cuenta: number, datos: { id_producto: number; cantidad: number; precio_unitario: number; nota?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/${id_cuenta}/producto`, datos, { headers: this.h() });
  }

  quitarProducto(id_detalle: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/cuentas/detalle/${id_detalle}`, { headers: this.h() });
  }

  cerrarCuenta(id_cuenta: number, metodo_pago: string, id_sucursal: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/cuentas/${id_cuenta}/cerrar`, { metodo_pago, id_sucursal }, { headers: this.h() });
  }

getProductos(id_sucursal: number = 1): Observable<any[]> {
  return this.http.get<any[]>(
    `${this.apiUrl}/catalogo/productos?id_sucursal=${id_sucursal}`,
    { headers: this.h() }
  );
}

  resetMesa(id_mesa: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/cuentas/reset-mesa`, { id_mesa }, { headers: this.h() });
  }

  getQR(id_mesa: number): Observable<any> {
  // Construir la URL base del frontend correctamente
  const protocol = window.location.protocol;
  const hostname  = window.location.hostname;
  const port      = window.location.port;

  // URL que el celular del cliente usará para escanear el QR
  const frontendBase = port
    ? `${protocol}//${hostname}:${port}`
    : `${protocol}//${hostname}`;

  const url = `${this.apiUrl}/mesas/${id_mesa}/qr?base_url=${encodeURIComponent(frontendBase)}`;
  return this.http.get<any>(url, { headers: this.h() });
}
}