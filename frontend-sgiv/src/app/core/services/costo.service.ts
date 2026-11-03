import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// ─── Costos de producción (solo administrador) ───

export type TipoUnidad = 'PESO' | 'VOLUMEN' | 'CANTIDAD';
export interface Unidad { id_unidad: number; codigo: string; nombre: string; tipo: TipoUnidad; factor_base: number }

export interface Insumo {
  id_insumo: number;
  nombre: string;
  cantidad_compra: number;
  id_unidad_compra: number;
  unidad_compra: string;
  tipo: TipoUnidad;
  precio_compra: number;
  fecha_precio: string;
  /** Costo de 1 g, 1 ml o 1 unidad */
  costo_base: number;
  recetas: number;
}

export interface Receta {
  id_receta: number;
  nombre: string;
  rendimiento: number;
  inversion: number;
  por_unidad: number;
  fecha_calculo: string;
  ingredientes?: number;
}

export interface Ingrediente { id_insumo: number; nombre?: string; cantidad: number; id_unidad: number; unidad?: string; costo?: number }
export interface RecetaDetalle extends Omit<Receta, 'ingredientes'> { ingredientes: Ingrediente[] }

export interface NuevoInsumo { nombre: string; cantidad_compra: number; id_unidad_compra: number; precio_compra: number }
export interface NuevaReceta { nombre: string; rendimiento: number; ingredientes: { id_insumo: number; cantidad: number; id_unidad: number }[] }

@Injectable({ providedIn: 'root' })
export class CostoService {
  private http = inject(HttpClient);
  private api  = `${environment.apiUrl}/costos`;

  unidades()                              { return this.http.get<Unidad[]>(`${this.api}/unidades`); }

  insumos()                               { return this.http.get<Insumo[]>(`${this.api}/insumos`); }
  crearInsumo(d: NuevoInsumo)             { return this.http.post<{ id_insumo: number; recetas_actualizadas?: number }>(`${this.api}/insumos`, d); }
  actualizarInsumo(id: number, d: Partial<NuevoInsumo>) {
    return this.http.put<{ recetas_actualizadas: number }>(`${this.api}/insumos/${id}`, d);
  }
  eliminarInsumo(id: number)              { return this.http.delete(`${this.api}/insumos/${id}`); }
  historialInsumo(id: number)             { return this.http.get<any[]>(`${this.api}/insumos/${id}/historial`); }

  recetas()                               { return this.http.get<Receta[]>(`${this.api}/recetas`); }
  receta(id: number)                      { return this.http.get<RecetaDetalle>(`${this.api}/recetas/${id}`); }
  guardarReceta(id: number | null, d: NuevaReceta) {
    return id ? this.http.put<{ id_receta: number }>(`${this.api}/recetas/${id}`, d)
              : this.http.post<{ id_receta: number }>(`${this.api}/recetas`, d);
  }
  eliminarReceta(id: number)              { return this.http.delete(`${this.api}/recetas/${id}`); }
  historialReceta(id: number)             { return this.http.get<any[]>(`${this.api}/recetas/${id}/historial`); }
}
