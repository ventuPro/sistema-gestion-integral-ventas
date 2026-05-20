import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, RouterOutlet, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LucideAngularModule,
         LayoutDashboard, Package, ShoppingCart,
         LayoutGrid, FileText, TrendingUp, Users,
         Landmark, LogOut, ChevronRight, Building2, RefreshCw } from 'lucide-angular';
import { PermisoService } from '../../../core/services/permiso.service';
import { AuthService }    from '../../../core/services/auth.service';
import { Subscription }   from 'rxjs';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule, LucideAngularModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private router         = inject(Router);
  private permisoService = inject(PermisoService);
  private authService    = inject(AuthService);
  private cdr            = inject(ChangeDetectorRef);

  usuario:        any  = null;
  esAdmin         = false;
  esCajero        = false;
  nombreSucursal  = '';

  /** Cache reactivo de permisos — se actualiza con permisos$ del service */
  permisosActuales: Record<string, boolean> = {};
  recargandoPermisos = false;
  toastPermisos: string | null = null;

  private subPermisos?: Subscription;

  // Iconos
  readonly icons = {
    dashboard:  LayoutDashboard,
    inventario: Package,
    pos:        ShoppingCart,
    mesas:      LayoutGrid,
    arqueo:     FileText,
    reportes:   TrendingUp,
    usuarios:   Users,
    cierres:    Landmark,
    logout:     LogOut,
    chevron:    ChevronRight,
    sucursal:   Building2,
    refresh:    RefreshCw
  };

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      this.usuario       = JSON.parse(raw);
      this.esAdmin       = this.usuario.id_rol === 1;
      this.esCajero      = this.usuario.id_rol === 2;
      this.nombreSucursal = this.usuario.nombre_sucursal || '';
    }

    // Inicializar cache con lo que haya en localStorage
    try {
      this.permisosActuales = JSON.parse(localStorage.getItem('permisos_sgiv') || '{}');
    } catch { this.permisosActuales = {}; }

    // Suscribirse a cambios de permisos (re-renderiza el sidebar)
    this.subPermisos = this.permisoService.permisos$.subscribe(p => {
      if (!p || Object.keys(p).length === 0) return;
      const previo = JSON.stringify(this.permisosActuales);
      const nuevo  = JSON.stringify(p);
      this.permisosActuales = p;
      this.cdr.detectChanges();
      if (previo !== nuevo && !this.esAdmin) {
        this.mostrarToast('🔄 Tus permisos fueron actualizados por el administrador.');
      }
    });

    // Arrancar poll silencioso solo para no-admin
    if (!this.esAdmin) {
      this.permisoService.iniciarPollPermisos(30000);  // cada 30s
    }
  }

  ngOnDestroy() {
    this.subPermisos?.unsubscribe();
    this.permisoService.detenerPoll();
  }

  tiene(modulo: string): boolean {
    if (this.esAdmin) return true;
    // Usar el cache reactivo si está poblado, sino fallback al service
    if (Object.keys(this.permisosActuales).length > 0) {
      return this.permisosActuales[modulo] === true;
    }
    return this.permisoService.tienePermiso(modulo);
  }

  /** Botón manual de recarga (cajero) */
  recargarPermisos() {
    if (this.recargandoPermisos) return;
    this.recargandoPermisos = true;
    this.permisoService.recargarPermisos().subscribe({
      next: () => {
        this.recargandoPermisos = false;
        this.mostrarToast('✓ Permisos actualizados.');
        this.cdr.detectChanges();
      },
      error: () => {
        this.recargandoPermisos = false;
        this.mostrarToast('No se pudieron recargar los permisos.');
        this.cdr.detectChanges();
      }
    });
  }

  private mostrarToast(msg: string) {
    this.toastPermisos = msg;
    this.cdr.detectChanges();
    setTimeout(() => { this.toastPermisos = null; this.cdr.detectChanges(); }, 4000);
  }

  cerrarSesion() {
    this.authService.cerrarSesion();
    this.permisoService.limpiarPermisos();
    this.router.navigate(['/login']);
  }
}