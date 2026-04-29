import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { DashboardComponent } from './features/admin/dashboard/dashboard.component';
import { ResumenComponent } from './features/admin/resumen/resumen.component';
import { InventarioComponent } from './features/admin/inventario/inventario.component';
import { PuntoVentaComponent } from './features/admin/punto-venta/punto-venta.component';
import { ArqueoComponent } from './features/admin/arqueo/arqueo.component';
import { UsuariosComponent } from './features/admin/usuarios/usuarios.component';
import { ReportesComponent } from './features/admin/reportes/reportes.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  {
    path: 'dashboard',
    component: DashboardComponent,
    children: [
      { path: '',            redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'resumen',     component: ResumenComponent },
      { path: 'inventario',  component: InventarioComponent },
      { path: 'punto-venta', component: PuntoVentaComponent },
      { path: 'arqueo',      component: ArqueoComponent },
      { path: 'usuarios',    component: UsuariosComponent },
      { path: 'reportes',    component: ReportesComponent }
    ]
  }
];