import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

// ─── Token de sesión en cada petición a la API ───
// Los servicios no arman el encabezado: se agrega aquí si hay sesión.
export const autenticacionInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  if (!token || !req.url.startsWith(environment.apiUrl) || req.headers.has('Authorization')) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
