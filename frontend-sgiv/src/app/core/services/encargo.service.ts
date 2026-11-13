import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export const TIPOS_EVENTO = ['CUMPLEAÑOS', 'BODA', 'QUINCE AÑOS', 'BAUTIZO', 'GRADUACIÓN', 'EMPRESA', 'OTRO'] as const;

export interface LineaEncargo {
  id_producto: number | null;
  descripcion: string;
  personalizado?: boolean;
  detalle: string | null;
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal?: number;
}

export interface Encargo {
  id_encargo?: number;
  id_sucursal: number | null;
  nombre_sucursal?: string;
  nombre_cliente: string;
  celular_cliente: string;
  tipo_evento: string;
  fecha: string;           // AAAA-MM-DD
  hora: string;            // HH:MM
  a_domicilio: boolean;
  direccion_entrega: string | null;
  observaciones: string | null;
  adelanto: number | null;
  estado?: 'Recibido' | 'Entregado';
  fecha_registro?: string;
  fecha_entregado?: string | null;
  registrado_por?: string;
  entregado_por?: string | null;
  atrasado?: boolean;
  total?: number;
  saldo?: number;
  items: LineaEncargo[];
}

export interface FiltroEncargos {
  id_sucursal?: number | null;
  desde?: string | null;
  hasta?: string | null;
  estado?: 'Recibido' | 'Entregado' | null;
  buscar?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EncargoService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/encargos`;

  listar(f: FiltroEncargos): Observable<Encargo[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<Encargo[]>(this.url, { params });
  }

  /** Pendientes de hoy y atrasados (ventana al iniciar el día) */
  deHoy(): Observable<Encargo[]> { return this.http.get<Encargo[]>(`${this.url}/hoy`); }

  guardar(e: Encargo): Observable<{ mensaje: string; encargo: Encargo }> {
    return e.id_encargo
      ? this.http.put<{ mensaje: string; encargo: Encargo }>(`${this.url}/${e.id_encargo}`, e)
      : this.http.post<{ mensaje: string; encargo: Encargo }>(this.url, e);
  }

  cambiarEstado(id: number, entregado: boolean): Observable<{ mensaje: string; encargo: Encargo }> {
    return this.http.patch<{ mensaje: string; encargo: Encargo }>(`${this.url}/${id}/estado`, { entregado });
  }

  eliminar(id: number): Observable<{ mensaje: string }> {
    return this.http.delete<{ mensaje: string }>(`${this.url}/${id}`);
  }
}

/** Cómo se paga: lo deduce del adelanto y el total */
export const estadoPago = (e: Pick<Encargo, 'adelanto' | 'total' | 'estado'>): { texto: string; clase: string } => {
  const adelanto = Number(e.adelanto) || 0, total = Number(e.total) || 0;
  if (e.estado === 'Entregado') return { texto: 'Cobrado', clase: 'ok' };
  if (total > 0 && adelanto >= total) return { texto: 'Pagado todo', clase: 'ok' };
  if (adelanto > 0) return { texto: 'Con adelanto', clase: 'aviso' };
  return { texto: 'Paga al entregar', clase: 'neutro' };
};
