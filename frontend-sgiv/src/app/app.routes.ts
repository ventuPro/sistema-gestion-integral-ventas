import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { permisoGuard }   from './core/guards/permiso.guard';

// Cada pantalla se descarga recién cuando se abre (carga diferida): el login y el
// menú QR del cliente no traen el panel, los gráficos ni las librerías de PDF/Excel.
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },

  // Menú digital del cliente (sin auth). :codigo = código QR de la mesa
  {
    path: 'menu/:codigo',
    loadComponent: () => import('./features/cliente/menu-digital/menu-digital.component').then(m => m.MenuDigitalComponent)
  },

  // Dashboard admin/cajero
  {
    path: 'dashboard',
    loadComponent: () => import('./features/admin/dashboard/dashboard.component').then(m => m.DashboardComponent),
    children: [
      { path: '', redirectTo: 'resumen', pathMatch: 'full' },
      {
        path: 'sin-acceso',
        loadComponent: () => import('./features/shared/sin-acceso/sin-acceso.component').then(m => m.SinAccesoComponent)
      },
      {
        path: 'resumen',
        loadComponent: () => import('./features/admin/resumen/resumen.component').then(m => m.ResumenComponent),
        canActivate: [permisoGuard('dashboard')]
      },
      {
        path: 'inventario',
        loadComponent: () => import('./features/admin/inventario/inventario.component').then(m => m.InventarioComponent),
        canActivate: [permisoGuard('inventario')]
      },
      {
        path: 'punto-venta',
        loadComponent: () => import('./features/admin/punto-venta/punto-venta.component').then(m => m.PuntoVentaComponent),
        canActivate: [permisoGuard('punto_venta')]
      },
      {
        path: 'mesas',
        loadComponent: () => import('./features/admin/mesas/mesas.component').then(m => m.MesasComponent),
        canActivate: [permisoGuard('mesas')]
      },
      {
        path: 'arqueo',
        loadComponent: () => import('./features/admin/arqueo/arqueo.component').then(m => m.ArqueoComponent),
        canActivate: [permisoGuard('arqueo')]
      },
      {
        path: 'usuarios',
        loadComponent: () => import('./features/admin/usuarios/usuarios.component').then(m => m.UsuariosComponent),
        canActivate: [permisoGuard('usuarios')]
      },
      {
        path: 'reportes',
        loadComponent: () => import('./features/admin/reportes/reportes.component').then(m => m.ReportesComponent),
        canActivate: [permisoGuard('reportes')]
      },
      {
        // Solo administrador: 'ajustes' no es un permiso asignable a cajeros
        path: 'ajustes',
        loadComponent: () => import('./features/admin/ajustes/ajustes.component').then(m => m.AjustesComponent),
        canActivate: [permisoGuard('ajustes')]
      },
      {
        path: 'cierres-caja',
        loadComponent: () => import('./features/admin/cierres-caja/cierres-caja.component').then(m => m.CierresCajaComponent),
        canActivate: [permisoGuard('ajustes')]   // solo administrador
      }
    ]
  }
];
