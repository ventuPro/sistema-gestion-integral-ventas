import { Component, inject } from '@angular/core';
import { Router, RouterOutlet, RouterModule } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule], // <-- ¡Vital para que funcione el menú!
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  private router = inject(Router);

  cerrarSesion() {
    localStorage.removeItem('token_sgiv');
    this.router.navigate(['/login']);
  }
}