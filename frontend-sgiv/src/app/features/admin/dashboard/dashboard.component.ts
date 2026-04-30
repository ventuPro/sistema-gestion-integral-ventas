import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterOutlet, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PermisoService } from '../../../core/services/permiso.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private router         = inject(Router);
  private permisoService = inject(PermisoService);
  private authService    = inject(AuthService);

  usuario: any  = null;
  esAdmin       = false;
  esCajero      = false;

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      this.usuario  = JSON.parse(raw);
      this.esAdmin  = this.usuario.id_rol === 1;
      this.esCajero = this.usuario.id_rol === 2;
    }
  }

  tiene(modulo: string): boolean {
    if (this.esAdmin) return true;
    return this.permisoService.tienePermiso(modulo);
  }

  cerrarSesion() {
    this.authService.cerrarSesion();
    this.permisoService.limpiarPermisos();
    this.router.navigate(['/login']);
  }
}