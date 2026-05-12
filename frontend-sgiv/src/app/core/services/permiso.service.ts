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

@Injectable({ providedIn: 'root' })
export class PermisoService {
  private apiUrl = environment.apiUrl;
  private permisosSubject = new BehaviorSubject<Record<string, boolean>>({});

  constructor(private http: HttpClient) {}

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  cargarMisPermisos(): Observable<any> {
    return new Observable(observer => {
      this.http.get<any>(`${this.apiUrl}/permisos/mis-permisos`, { headers: this.h() })
        .subscribe({
          next: (res) => {
            const permisos = res.permisos || {};
            this.permisosSubject.next(permisos);
            localStorage.setItem('permisos_sgiv', JSON.stringify(permisos));
            observer.next(permisos);
            observer.complete();
          },
          error: (e) => {
            // Si falla, usar permisos vacíos y continuar
            this.permisosSubject.next({});
            localStorage.setItem('permisos_sgiv', JSON.stringify({}));
            observer.next({});
            observer.complete();
          }
        });
    });
  }

  tienePermiso(modulo: string): boolean {
    const raw = localStorage.getItem('permisos_sgiv');
    if (!raw) return false;
    try {
      const permisos = JSON.parse(raw);
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