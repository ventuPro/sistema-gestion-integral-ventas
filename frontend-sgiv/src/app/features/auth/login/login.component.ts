import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PermisoService } from '../../../core/services/permiso.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  correo   = '';
  contrasena = '';
  mensajeError = '';
  cargando = false;

  private authService    = inject(AuthService);
  private permisoService = inject(PermisoService);
  private router         = inject(Router);

  iniciarSesion() {
    if (!this.correo || !this.contrasena) {
      this.mensajeError = 'Ingresa tu correo y contraseña.'; return;
    }
    this.cargando = true;
    this.mensajeError = '';

    this.authService.login(this.correo, this.contrasena).subscribe({
      next: (res) => {
        this.authService.guardarToken(res.token);
        localStorage.setItem('usuario_sgiv', JSON.stringify({
          id_usuario:      res.usuario.id_usuario,
          nombre_completo: res.usuario.nombre_completo,
          id_rol:          res.usuario.id_rol,
          id_sucursal:     res.usuario.id_sucursal
        }));

        // Cargar permisos antes de redirigir
        this.permisoService.cargarMisPermisos().subscribe({
          next: () => {
            this.cargando = false;
            // Redirigir según rol
            if (res.usuario.id_rol === 3) {
              this.router.navigate(['/cocina']);
            } else {
              this.router.navigate(['/dashboard']);
            }
          },
          error: () => {
            // Si falla la carga de permisos, igual redirigir
            this.cargando = false;
            this.router.navigate(['/dashboard']);
          }
        });
      },
      error: (e) => {
        this.cargando = false;
        this.mensajeError = e.status === 401 || e.status === 404
          ? 'Correo o contraseña incorrectos.'
          : 'Error al conectar con el servidor.';
      }
    });
  }
}