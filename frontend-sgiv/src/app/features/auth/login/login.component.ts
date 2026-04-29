import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  correo: string = '';
  contrasena: string = '';
  mensajeError: string = '';
  cargando: boolean = false;

  private authService = inject(AuthService);
  private router = inject(Router);

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
        // Guardamos datos del usuario para permisos en el menú
        localStorage.setItem('usuario_sgiv', JSON.stringify({
          id_usuario: respuesta.usuario.id_usuario,
          nombre_completo: respuesta.usuario.nombre_completo,
          id_rol: respuesta.usuario.id_rol,
          id_sucursal: respuesta.usuario.id_sucursal
        }));
        this.cargando = false;
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