import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const DEFAULTS_CAJERO: Record<string, boolean> = {
  dashboard: true, inventario: false, punto_venta: true,
  mesas: true, arqueo: true, reportes: false, usuarios: false
};

export function permisoGuard(modulo: string): CanActivateFn {
  return () => {
    const router = inject(Router);

    // Sin sesión → login
    const rawUser = localStorage.getItem('usuario_sgiv');
    if (!rawUser) { router.navigate(['/login']); return false; }

    const u = JSON.parse(rawUser);

    // Admin siempre pasa
    if (Number(u.id_rol) === 1) return true;

    // Leer permisos del cache
    const rawPermisos = localStorage.getItem('permisos_sgiv');

    if (!rawPermisos || rawPermisos === '{}' || rawPermisos === 'null') {
      // Sin cache → usar defaults del cajero
      if (Number(u.id_rol) === 2) {
        return DEFAULTS_CAJERO[modulo] === true
          ? true
          : (router.navigate(['/dashboard/sin-acceso']), false);
      }
      router.navigate(['/dashboard/sin-acceso']);
      return false;
    }

    try {
      const permisos = JSON.parse(rawPermisos);
      if (permisos[modulo] === true) return true;
      router.navigate(['/dashboard/sin-acceso']);
      return false;
    } catch {
      router.navigate(['/dashboard/sin-acceso']);
      return false;
    }
  };
}