import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export const MODULOS = [
  { key: 'dashboard',   label: 'Panel Principal'  },
  { key: 'inventario',  label: 'Inventario'        },
  { key: 'punto_venta', label: 'Punto de Venta'    },
  { key: 'mesas',       label: 'Mesas'             },
  { key: 'arqueo',      label: 'Arqueo de Caja'    },
  { key: 'reportes',    label: 'Reportes'          },
  { key: 'usuarios',    label: 'Usuarios'          },
  { key: 'cocina',      label: 'Cocina (KDS)'      }
];

// Permisos por defecto según rol (usados cuando la API falla)
const DEFAULTS: Record<number, Record<string, boolean>> = {
  1: { dashboard:true, inventario:true, punto_venta:true, mesas:true, arqueo:true, reportes:true, usuarios:true, cocina:true },
  2: { dashboard:true, inventario:false, punto_venta:true, mesas:true, arqueo:true, reportes:false, usuarios:false, cocina:false },
  3: { dashboard:false, inventario:false, punto_venta:false, mesas:false, arqueo:false, reportes:false, usuarios:false, cocina:true }
};

@Injectable({ providedIn: 'root' })
export class PermisoService {
  private apiUrl = environment.apiUrl;
  private permisosSubject = new BehaviorSubject<Record<string, boolean>>({});

  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  private getRolActual(): number {
    try {
      const raw = localStorage.getItem('usuario_sgiv');
      return raw ? Number(JSON.parse(raw).id_rol) : 0;
    } catch { return 0; }
  }

  private getDefaults(): Record<string, boolean> {
    return { ...(DEFAULTS[this.getRolActual()] || {}) };
  }

  cargarMisPermisos(): Observable<Record<string, boolean>> {
    return new Observable(observer => {
      this.http.get<any>(`${this.apiUrl}/permisos/mis-permisos`, { headers: this.h() }).subscribe({
        next: (res) => {
          const permisos: Record<string, boolean> = res?.permisos || this.getDefaults();
          this.permisosSubject.next(permisos);
          localStorage.setItem('permisos_sgiv', JSON.stringify(permisos));
          observer.next(permisos);
          observer.complete();
        },
        error: () => {
          // Si la API falla: usar defaults del rol (NUNCA guardar objeto vacío)
          const permisos = this.getDefaults();
          this.permisosSubject.next(permisos);
          localStorage.setItem('permisos_sgiv', JSON.stringify(permisos));
          observer.next(permisos);
          observer.complete();
        }
      });
    });
  }

  tienePermiso(modulo: string): boolean {
    try {
      const raw = localStorage.getItem('permisos_sgiv');

      // Sin permisos en cache → usar defaults del rol
      if (!raw) {
        const def = this.getDefaults();
        return def[modulo] === true;
      }

      const permisos = JSON.parse(raw);

      // Si el objeto está vacío → usar defaults
      if (Object.keys(permisos).length === 0) {
        const def = this.getDefaults();
        return def[modulo] === true;
      }

      return permisos[modulo] === true;
    } catch {
      return false;
    }
  }

  obtenerPermisosUsuario(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/permisos/usuario/${id_usuario}`, { headers: this.h() });
  }

  guardarPermisosUsuario(id_usuario: number, permisos: Record<string, boolean>): Observable<any> {
    return this.http.put(
      `${this.apiUrl}/permisos/usuario/${id_usuario}`,
      { permisos },
      { headers: this.h() }
    );
  }

  limpiarPermisos() {
    this.permisosSubject.next({});
    localStorage.removeItem('permisos_sgiv');
  }
}