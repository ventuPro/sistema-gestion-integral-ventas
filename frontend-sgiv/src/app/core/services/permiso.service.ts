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
  private pollHandle: any = null;

  /** Observable que el dashboard puede consumir para re-renderizar el sidebar */
  public permisos$ = this.permisosSubject.asObservable();

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
    this.detenerPoll();
    this.permisosSubject.next({});
    localStorage.removeItem('permisos_sgiv');
  }

  /**
   * Inicia un polling silencioso que recarga los permisos del usuario logueado
   * cada N segundos. Si cambian, emite por permisos$ y actualiza localStorage.
   * Admin (id_rol = 1) no necesita poll: siempre tiene todo.
   */
  iniciarPollPermisos(intervaloMs: number = 30000) {
    if (this.getRolActual() === 1) return;  // admin: skip
    this.detenerPoll();
    this.pollHandle = setInterval(() => this.recargarPermisos().subscribe(), intervaloMs);
  }

  detenerPoll() {
    if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; }
  }

  /**
   * Recarga los permisos del servidor. Si cambiaron respecto al cache, los
   * actualiza y emite por permisos$. Devuelve un Observable que el cajero
   * puede usar para refrescar manualmente con un botón.
   */
  recargarPermisos(): Observable<Record<string, boolean>> {
    return new Observable(observer => {
      this.http.get<any>(`${this.apiUrl}/permisos/mis-permisos`, { headers: this.h() }).subscribe({
        next: (res) => {
          const nuevos: Record<string, boolean> = res?.permisos || this.getDefaults();
          const previo = localStorage.getItem('permisos_sgiv') || '{}';
          const nuevoStr = JSON.stringify(nuevos);
          if (nuevoStr !== previo) {
            localStorage.setItem('permisos_sgiv', nuevoStr);
            this.permisosSubject.next(nuevos);
          }
          observer.next(nuevos);
          observer.complete();
        },
        error: (e) => observer.error(e)
      });
    });
  }
}