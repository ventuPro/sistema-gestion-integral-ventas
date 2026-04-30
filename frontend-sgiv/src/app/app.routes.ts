import { Routes } from '@angular/router';
import { LoginComponent }       from './features/auth/login/login.component';
import { DashboardComponent }   from './features/admin/dashboard/dashboard.component';
import { ResumenComponent }     from './features/admin/resumen/resumen.component';
import { InventarioComponent }  from './features/admin/inventario/inventario.component';
import { PuntoVentaComponent }  from './features/admin/punto-venta/punto-venta.component';
import { ArqueoComponent }      from './features/admin/arqueo/arqueo.component';
import { UsuariosComponent }    from './features/admin/usuarios/usuarios.component';
import { ReportesComponent }    from './features/admin/reportes/reportes.component';
import { MesasComponent }       from './features/admin/mesas/mesas.component';
import { KdsComponent }         from './features/cocina/kds/kds.component';
import { MenuDigitalComponent } from './features/cliente/menu-digital/menu-digital.component';
import { SinAccesoComponent }   from './features/shared/sin-acceso/sin-acceso.component';
import { permisoGuard }         from './core/guards/permiso.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },

  // App de cocina (acceso independiente)
  { path: 'cocina', component: KdsComponent },

  // Menú digital del cliente (sin auth)
  { path: 'menu/:id_mesa', component: MenuDigitalComponent },

  // Dashboard admin/cajero
  {
    path: 'dashboard',
    component: DashboardComponent,
    children: [
      { path: '',            redirectTo: 'resumen', pathMatch: 'full' },
      { path: 'sin-acceso',  component: SinAccesoComponent },
      {
        path: 'resumen',
        component: ResumenComponent,
        canActivate: [permisoGuard('dashboard')]
      },
      {
        path: 'inventario',
        component: InventarioComponent,
        canActivate: [permisoGuard('inventario')]
      },
      {
        path: 'punto-venta',
        component: PuntoVentaComponent,
        canActivate: [permisoGuard('punto_venta')]
      },
      {
        path: 'mesas',
        component: MesasComponent,
        canActivate: [permisoGuard('mesas')]
      },
      {
        path: 'arqueo',
        component: ArqueoComponent,
        canActivate: [permisoGuard('arqueo')]
      },
      {
        path: 'usuarios',
        component: UsuariosComponent,
        canActivate: [permisoGuard('usuarios')]
      },
      {
        path: 'reportes',
        component: ReportesComponent,
        canActivate: [permisoGuard('reportes')]
      }
    ]
  }
];