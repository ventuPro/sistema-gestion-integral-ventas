import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// ─── Ajustes → Auditoría (solo lectura) ───
export type TipoMovimiento = 'crear' | 'modificar' | 'eliminar';

export interface Movimiento {
  id: string;
  fecha: string;
  usuario: string;
  correo: string | null;
  id_usuario: number | null;
  ip: string | null;
  sucursal: string | null;
  modulo: string;
  tipo: TipoMovimiento;
  accion: string;
  detalle: string;
  filas: number;
}

export interface CampoCambio { campo: string; antes: string | null; despues: string | null }

export interface DetalleMovimiento extends Movimiento {
  origen: string;
  navegador: string | null;
  agente: string | null;
  estado_http: number | null;
  duracion_ms: number | null;
  truncado: boolean;
  cambios: { id: number; tabla: string; operacion: string; tipo: string; registro: string | null; campos: CampoCambio[] }[];
}

export interface Acceso {
  id: number;
  fecha: string;
  hasta: string | null;
  veces: number;
  evento: string;
  texto: string;
  nivel: 'ok' | 'mal' | 'aviso' | 'neutro';
  usuario: string;
  correo: string | null;
  ip: string | null;
  navegador: string | null;
  ruta: string;
  estado_http: number | null;
  detalle: string | null;
}

export interface OpcionesAuditoria {
  usuarios: { id_usuario: number; nombre_completo: string; nombre_rol: string; estado_activo: boolean }[];
  sucursales: { id_sucursal: number; nombre_sucursal: string }[];
  modulos: { id: string; nombre: string }[];
  tipos_acceso: { id: string; nombre: string }[];
}

export interface FiltrosAuditoria {
  desde: string;
  hasta: string;
  usuario: string;
  id_sucursal: string;
  modulo: string;
  accion: string;
  tipo: string;
  q: string;
}

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/ajustes/auditoria`;

  private parametros(f: Partial<FiltrosAuditoria>, extra: Record<string, string | number | null>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries({ ...f, ...extra }))
      if (v !== null && v !== undefined && String(v).trim() !== '') p = p.set(k, String(v).trim());
    return p;
  }

  opciones() {
    return this.http.get<OpcionesAuditoria>(`${this.api}/opciones`);
  }

  movimientos(f: FiltrosAuditoria, antes: number | null = null, por_pagina = 50) {
    const { tipo, ...filtros } = f;
    return this.http.get<{ movimientos: Movimiento[]; siguiente: number | null }>(
      `${this.api}/movimientos`, { params: this.parametros(filtros, { antes, por_pagina }) });
  }

  movimiento(id: string) {
    return this.http.get<DetalleMovimiento>(`${this.api}/movimientos/${id}`);
  }

  accesos(f: FiltrosAuditoria, antes: number | null = null, por_pagina = 50) {
    const { desde, hasta, usuario, tipo, q } = f;
    return this.http.get<{ accesos: Acceso[]; siguiente: number | null }>(
      `${this.api}/accesos`, { params: this.parametros({ desde, hasta, usuario, tipo, q }, { antes, por_pagina }) });
  }
}
