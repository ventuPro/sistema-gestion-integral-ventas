// Archivo: src/app/app.routes.ts  (o app-routing.module.ts)
import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component'; // Importamos el componente

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // Redirige la raíz al login
  { path: 'login', component: LoginComponent },         // Carga la pantalla de login
  // Más adelante agregaremos las rutas del dashboard y el menú digital aquí
];