import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { DashboardComponent } from './features/admin/dashboard/dashboard.component';
import { ResumenComponent } from './features/admin/resumen/resumen.component';
import { InventarioComponent } from './features/admin/inventario/inventario.component';
import { PuntoVentaComponent } from './features/admin/punto-venta/punto-venta.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { 
    path: 'dashboard', 
    component: DashboardComponent,
    children: [
      // Cuando entren a /dashboard, por defecto mostramos el resumen
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen', component: ResumenComponent },
      { path: 'inventario', component: InventarioComponent },
      { path: 'punto-venta', component: PuntoVentaComponent }
    ]
  }
];