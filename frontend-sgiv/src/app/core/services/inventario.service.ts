import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TipoMovimiento = 'INGRESO' | 'SALIDA';

export interface Movimiento {
  id_historial:      number;
  fecha_registro:    string;
  tipo_movimiento:   TipoMovimiento;
  cantidad_movida:   number;
  motivo_movimiento: string;
  detalle:           string | null;
  stock_resultante:  number | null;
  id_producto:       number;
  nombre_producto:   string;
  usuario:           string | null;
}

export interface FiltrosMovimientos {
  id_sucursal: number;
  id_producto?: number | null;
  tipo?: TipoMovimiento | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface NuevaTransferencia {
  id_sucursal_origen: number;
  id_sucursal_destino: number;
  items: { id_producto: number; cantidad: number }[];
  observacion?: string | null;
}

export interface Transferencia {
  id_transferencia:    number;
  fecha_transferencia: string;
  observacion:         string | null;
  id_sucursal_origen:  number;
  nombre_origen:       string;
  id_sucursal_destino: number;
  nombre_destino:      string;
  usuario:             string | null;
  productos?:          number;
  unidades?:           number;
  items?:              { id_producto: number; nombre_producto: string; cantidad: number }[];
}

// ─── Movimientos de inventario: entradas y mermas con motivo ───
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private http = inject(HttpClient);
  private api  = `${environment.apiUrl}/inventario`;

  /** Los motivos no cambian: se piden una sola vez */
  readonly motivos$: Observable<Record<TipoMovimiento, string[]>> =
    this.http.get<Record<TipoMovimiento, string[]>>(`${this.api}/motivos`).pipe(shareReplay(1));

  registrar(datos: { id_producto: number; id_sucursal: number; tipo: TipoMovimiento; cantidad: number; motivo: string; detalle?: string }) {
    return this.http.post<{ mensaje: string; stock_actual: number }>(`${this.api}/movimientos`, datos);
  }

  listar(f: FiltrosMovimientos): Observable<Movimiento[]> {
    let params = new HttpParams().set('id_sucursal', f.id_sucursal);
    if (f.id_producto) params = params.set('id_producto', f.id_producto);
    if (f.tipo)        params = params.set('tipo', f.tipo);
    if (f.desde)       params = params.set('desde', f.desde);
    if (f.hasta)       params = params.set('hasta', f.hasta);
    return this.http.get<Movimiento[]>(`${this.api}/movimientos`, { params });
  }

  // ─── Transferencias entre sucursales ───
  transferir(datos: NuevaTransferencia) {
    return this.http.post<{ mensaje: string; id_transferencia: number }>(`${this.api}/transferencias`, datos);
  }

  /** id_sucursal: las que salieron o llegaron a esa sucursal */
  listarTransferencias(f: { id_sucursal: number; desde?: string | null; hasta?: string | null }): Observable<Transferencia[]> {
    let params = new HttpParams().set('id_sucursal', f.id_sucursal);
    if (f.desde) params = params.set('desde', f.desde);
    if (f.hasta) params = params.set('hasta', f.hasta);
    return this.http.get<Transferencia[]>(`${this.api}/transferencias`, { params });
  }

  obtenerTransferencia(id: number): Observable<Transferencia> {
    return this.http.get<Transferencia>(`${this.api}/transferencias/${id}`);
  }
}
