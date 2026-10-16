import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// ─── Cookie de sesión en cada petición a la API ───
// La API está en otro puerto: sin withCredentials el navegador no envía ni guarda la cookie.
export const autenticacionInterceptor: HttpInterceptorFn = (req, next) =>
  req.url.startsWith(environment.apiUrl) ? next(req.clone({ withCredentials: true })) : next(req);
