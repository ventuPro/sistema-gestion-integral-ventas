import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermisoService } from '../services/permiso.service';

export function permisoGuard(modulo: string): CanActivateFn {
  return () => {
    const permisoService = inject(PermisoService);
    const router         = inject(Router);

    // Administrador (rol 1) siempre pasa
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      const u = JSON.parse(raw);
      if (u.id_rol === 1) return true;
    }

    if (permisoService.tienePermiso(modulo)) return true;

    router.navigate(['/dashboard/sin-acceso']);
    return false;
  };
}