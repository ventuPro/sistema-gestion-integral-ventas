import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  // Inyectamos el enrutador para poder viajar entre pantallas
  private router = inject(Router);

  // Función para cerrar la sesión
  cerrarSesion() {
    // 1. Borramos el pase VIP (token) del navegador
    localStorage.removeItem('token_sgiv');
    
    // 2. Lo expulsamos de vuelta a la pantalla de Login
    this.router.navigate(['/login']);
  }
}