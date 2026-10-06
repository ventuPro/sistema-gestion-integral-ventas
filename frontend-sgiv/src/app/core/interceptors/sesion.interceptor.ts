import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { SocketService } from '../services/socket.service';

// ─── Sesión expirada o usuario desactivado ───
// El backend responde 401 cuando el token venció o el usuario fue desactivado:
// se limpia la sesión local y se vuelve al login. El login propio se excluye
// porque usa 401 para "contraseña incorrecta".
export const sesionInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth   = inject(AuthService);
  const socket = inject(SocketService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const esLogin = req.url.includes('/usuarios/login');
      if (error.status === 401 && !esLogin && auth.estaLogueado()) {
        auth.cerrarSesion();
        socket.desconectar();
        router.navigate(['/login'], { queryParams: { sesion: 'expirada' } });
      }
      return throwError(() => error);
    })
  );
};
