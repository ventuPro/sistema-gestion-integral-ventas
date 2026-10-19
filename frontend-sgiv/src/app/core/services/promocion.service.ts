import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type TipoPromocion = 'PORCENTAJE' | 'PRECIO' | 'NXM' | 'COMBO';

export interface Promocion {
  id_promocion?:   number;
  nombre:          string;
  tipo:            TipoPromocion;
  valor:           number;
  lleva:           number | null;
  paga:            number | null;
  id_sucursal:     number | null;
  nombre_sucursal?: string | null;
  fecha_inicio:    string;
  fecha_fin:       string;
  dias_semana:     number[] | null;
  hora_inicio:     string | null;
  hora_fin:        string | null;
  estado_activo:   boolean;
  vigente?:        boolean;
  editable?:       boolean;
  usos?:           number;
  ahorro?:         number;
  productos:       { id_producto: number; cantidad: number; nombre_producto?: string; precio_unitario?: number }[];
  categorias:      { id_categoria: number; nombre_categoria?: string }[];
}

/** Promoción vigente, resumida para marcar productos en el catálogo */
export interface PromocionVigente {
  id_promocion: number;
  nombre:       string;
  tipo:         TipoPromocion;
  valor:        number;
  lleva:        number | null;
  paga:         number | null;
  productos:    number[];
  categorias:   number[];
}

/** Texto corto de la etiqueta: «−20 %», «Bs. 2.00», «3×2», «Combo» */
export const etiquetaPromocion = (p: { tipo: TipoPromocion; valor: number; lleva: number | null; paga: number | null }, moneda: string): string =>
  p.tipo === 'PORCENTAJE' ? `−${+p.valor} %`
  : p.tipo === 'PRECIO'   ? `${moneda} ${Number(p.valor).toFixed(2)}`
  : p.tipo === 'NXM'      ? `${p.lleva}×${p.paga}`
  : 'Combo';

/** Descuento manual del cajero al cobrar */
export interface DescuentoManual {
  tipo:   'PORCENTAJE' | 'MONTO';
  valor:  number;
  motivo: string;
}

export interface LineaCotizada {
  id_producto:         number;
  cantidad:            number;
  precio_unitario:     number;
  subtotal_bruto:      number;
  descuento_promocion: number;
  descuento_manual:    number;
  subtotal:            number;
  id_promocion:        number | null;
  promociones:         string[];
}

/** Precios finales calculados por el backend (promociones vigentes + descuento manual) */
export interface Cotizacion {
  items:                 LineaCotizada[];
  subtotal_bruto:        number;
  descuento_promociones: number;
  descuento_manual:      number;
  total:                 number;
  /** Tope del descuento manual en %; null = sin tope (administrador) */
  descuento_max?:        number | null;
}

// ─── Promociones: gestión y cotización de carritos ───
@Injectable({ providedIn: 'root' })
export class PromocionService {
  private http = inject(HttpClient);
  private api  = `${environment.apiUrl}/promociones`;

  /** Administrador: id_sucursal null = todas */
  listar(id_sucursal: number | null = null): Observable<Promocion[]> {
    const params = id_sucursal ? new HttpParams().set('id_sucursal', id_sucursal) : undefined;
    return this.http.get<Promocion[]>(this.api, { params });
  }

  guardar(p: Promocion): Observable<{ mensaje: string; promocion: Promocion }> {
    const body = {
      ...p,
      productos:  p.productos.map(x => ({ id_producto: x.id_producto, cantidad: x.cantidad })),
      categorias: p.categorias.map(c => c.id_categoria)
    };
    return p.id_promocion
      ? this.http.put<{ mensaje: string; promocion: Promocion }>(`${this.api}/${p.id_promocion}`, body)
      : this.http.post<{ mensaje: string; promocion: Promocion }>(this.api, body);
  }

  cambiarEstado(id: number, activa: boolean): Observable<{ mensaje: string }> {
    return this.http.patch<{ mensaje: string }>(`${this.api}/${id}/estado`, { activa });
  }

  eliminar(id: number): Observable<{ mensaje: string }> {
    return this.http.delete<{ mensaje: string }>(`${this.api}/${id}`);
  }

  /** Punto de venta: promociones vigentes en la sucursal (para las etiquetas del catálogo) */
  vigentesPuntoVenta(): Observable<PromocionVigente[]> {
    return this.http.get<PromocionVigente[]>(`${environment.apiUrl}/caja/promociones-vigentes`);
  }

  /** Punto de venta: total del carrito con promociones y descuento manual */
  cotizarVenta(detalles: { id_producto: number; cantidad: number }[], descuento: DescuentoManual | null): Observable<Cotizacion> {
    return this.http.post<Cotizacion>(`${environment.apiUrl}/caja/cotizar`, { detalles, descuento });
  }

  /** Mesas: lo pendiente de la cuenta (o de una persona) con promociones */
  cotizarCuenta(id_cuenta: number, cliente_mesa?: string | null): Observable<Cotizacion> {
    const params = cliente_mesa === undefined ? undefined : new HttpParams().set('cliente_mesa', cliente_mesa ?? '');
    return this.http.get<Cotizacion>(`${environment.apiUrl}/cuentas/${id_cuenta}/cotizacion`, { params });
  }
}
