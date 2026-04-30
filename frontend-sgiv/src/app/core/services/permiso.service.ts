import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export const MODULOS = [
  { key: 'dashboard',    label: 'Panel Principal'   },
  { key: 'inventario',   label: 'Inventario'         },
  { key: 'punto_venta',  label: 'Punto de Venta'     },
  { key: 'mesas',        label: 'Mesas'              },
  { key: 'arqueo',       label: 'Arqueo de Caja'     },
  { key: 'reportes',     label: 'Reportes'           },
  { key: 'usuarios',     label: 'Usuarios'           },
  { key: 'cocina',       label: 'Cocina (KDS)'       }
];

@Injectable({ providedIn: 'root' })
export class PermisoService {
  private apiUrl = environment.apiUrl;
  private permisosSubject = new BehaviorSubject<Record<string, boolean>>({});
  permisos$ = this.permisosSubject.asObservable();

  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  // Carga los permisos del usuario logueado y los guarda en memoria
  cargarMisPermisos(): Observable<any> {
    return new Observable(observer => {
      this.http.get(`${this.apiUrl}/permisos/mis-permisos`, { headers: this.h() }).subscribe({
        next: (res: any) => {
          this.permisosSubject.next(res.permisos || {});
          // También guardar en localStorage para acceso sincrónico
          localStorage.setItem('permisos_sgiv', JSON.stringify(res.permisos || {}));
          observer.next(res.permisos);
          observer.complete();
        },
        error: (e) => observer.error(e)
      });
    });
  }

  // Verificación sincrónica (usa la copia en localStorage)
  tienePermiso(modulo: string): boolean {
    const raw = localStorage.getItem('permisos_sgiv');
    if (!raw) return false;
    const permisos = JSON.parse(raw);
    return permisos[modulo] === true;
  }

  // Admin: obtener permisos de un usuario
  obtenerPermisosUsuario(id_usuario: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/permisos/usuario/${id_usuario}`, { headers: this.h() });
  }

  // Admin: guardar permisos de un usuario
  guardarPermisosUsuario(id_usuario: number, permisos: Record<string, boolean>): Observable<any> {
    return this.http.put(`${this.apiUrl}/permisos/usuario/${id_usuario}`, { permisos }, { headers: this.h() });
  }

  get permisosActuales(): Record<string, boolean> {
    return this.permisosSubject.getValue();
  }

  limpiarPermisos() {
    this.permisosSubject.next({});
    localStorage.removeItem('permisos_sgiv');
  }
}