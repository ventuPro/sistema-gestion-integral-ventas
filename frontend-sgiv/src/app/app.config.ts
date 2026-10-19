import { ApplicationConfig, inject, provideAppInitializer, provideCheckNoChangesConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { sesionInterceptor } from './core/interceptors/sesion.interceptor';
import { autenticacionInterceptor } from './core/interceptors/autenticacion.interceptor';
import { AjustesService } from './core/services/ajustes.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    // Solo en desarrollo: avisa (NG0100) si algo cambió sin una señal que refresque la vista
    provideCheckNoChangesConfig({ exhaustive: true, interval: 1000 }),
    provideHttpClient(withInterceptors([autenticacionInterceptor, sesionInterceptor])),
    // Nombre, logo, colores y tema del negocio antes de mostrar la primera pantalla
    provideAppInitializer(() => inject(AjustesService).iniciar())
  ]
};
