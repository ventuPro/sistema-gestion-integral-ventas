import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterOutlet, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private router = inject(Router);

  usuario: any = null;
  esAdmin: boolean = false;

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      this.usuario = JSON.parse(raw);
      // id_rol = 1 → Administrador (nivel_permiso 1 = acceso total)
      this.esAdmin = this.usuario.id_rol === 1;
    }
  }

  cerrarSesion() {
    localStorage.removeItem('token_sgiv');
    localStorage.removeItem('usuario_sgiv');
    this.router.navigate(['/login']);
  }
}