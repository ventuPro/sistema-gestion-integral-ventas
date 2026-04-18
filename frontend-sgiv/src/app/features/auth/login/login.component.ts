import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms'; 
import { CommonModule } from '@angular/common'; 
import { Router } from '@angular/router'; // <-- 1. Importamos el Router
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule], // <-- Agregamos los módulos aquí
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})

export class LoginComponent {
  correo: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  cargando: boolean = false;

  private authService = inject(AuthService);
  private router = inject(Router); // <-- 2. Inyectamos el Router

  iniciarSesion() {
    if (!this.correo || !this.contrasena) {
      this.mensajeError = 'Por favor, ingresa tu correo y contraseña.';
      return;
    }

    this.cargando = true;
    this.mensajeError = '';

    this.authService.login(this.correo, this.contrasena).subscribe({
      next: (respuesta) => {
        this.authService.guardarToken(respuesta.token);
        this.cargando = false;
        
        // 3. ¡Cambiamos el alert por la redirección!
        this.router.navigate(['/dashboard']); 
      },
      error: (errorBackend) => {
        this.cargando = false;
        if (errorBackend.status === 401 || errorBackend.status === 404) {
          this.mensajeError = 'Correo o contraseña incorrectos.';
        } else {
          this.mensajeError = 'Error al conectar con el servidor.';
        }
      }
    });
  }
}