import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SesionService } from '../services/sesion.service';
import { PermisoService } from '../services/permiso.service';

// ─── Acceso a una pantalla según los permisos del usuario (el administrador pasa siempre) ───
export function permisoGuard(modulo: string): CanActivateFn {
  return () => {
    const router = inject(Router);
    const sesion = inject(SesionService);
    if (!sesion.usuario()) return router.createUrlTree(['/login']);
    if (sesion.esAdmin() || inject(PermisoService).tienePermiso(modulo)) return true;
    return router.createUrlTree(['/dashboard/sin-acceso']);
  };
}
