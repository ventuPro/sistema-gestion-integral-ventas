import { Injectable, computed, signal } from '@angular/core';

// ─── Roles del sistema (id_rol en la BD) ───
export const ROL = { administrador: 1, cajero: 2 } as const;

/** Datos visibles del usuario; la sesión en sí viaja en la cookie httpOnly */
export interface UsuarioSesion {
  id_usuario:      number;
  nombre_completo: string;
  id_rol:          number;
  id_sucursal:     number;
  nombre_sucursal: string;
}

const CLAVE = 'usuario_sgiv';

const leer = (): UsuarioSesion | null => {
  try {
    const u = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    return u ? { ...u, id_usuario: Number(u.id_usuario), id_rol: Number(u.id_rol), id_sucursal: Number(u.id_sucursal) } : null;
  } catch { return null; }
};

// ─── Usuario de la sesión actual (único lugar que lee y escribe usuario_sgiv) ───
@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly usuario    = signal<UsuarioSesion | null>(leer());
  readonly esAdmin    = computed(() => this.usuario()?.id_rol === ROL.administrador);
  readonly esCajero   = computed(() => this.usuario()?.id_rol === ROL.cajero);
  readonly idSucursal = computed(() => this.usuario()?.id_sucursal || 1);

  constructor() {
    // Otra pestaña inició o cerró sesión
    window.addEventListener('storage', e => { if (e.key === CLAVE || e.key === null) this.usuario.set(leer()); });
  }

  iniciar(u: UsuarioSesion) {
    const usuario: UsuarioSesion = {
      id_usuario:      Number(u.id_usuario),
      nombre_completo: u.nombre_completo,
      id_rol:          Number(u.id_rol),
      id_sucursal:     Number(u.id_sucursal),
      nombre_sucursal: u.nombre_sucursal
    };
    try { localStorage.setItem(CLAVE, JSON.stringify(usuario)); } catch { }
    this.usuario.set(usuario);
  }

  cerrar() {
    try { localStorage.removeItem(CLAVE); } catch { }
    this.usuario.set(null);
  }
}
