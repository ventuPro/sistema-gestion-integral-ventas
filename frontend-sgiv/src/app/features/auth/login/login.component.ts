import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { PermisoService } from '../../../core/services/permiso.service';
import { AjustesService } from '../../../core/services/ajustes.service';

// ─── Login: correo, contraseña y CAPTCHA ───
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule, LucideAngularModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  readonly icons = { refrescar: RefreshCw };

  correo     = '';
  contrasena = '';
  mensajeError = '';
  cargando = false;

  // ─── CAPTCHA ───
  captchaId       = '';
  captchaImagen   = '';
  captchaTexto    = '';
  cargandoCaptcha = false;

  private authService    = inject(AuthService);
  private permisoService = inject(PermisoService);
  private router         = inject(Router);
  private route          = inject(ActivatedRoute);
  private cdr            = inject(ChangeDetectorRef);
  readonly ajustes       = inject(AjustesService);

  constructor() {
    // Redirigido por el interceptor: token vencido o usuario desactivado
    if (this.route.snapshot.queryParamMap.get('sesion') === 'expirada') {
      this.mensajeError = 'Tu sesión terminó o tu usuario fue desactivado. Inicia sesión nuevamente.';
    }
  }

  ngOnInit() { this.cargarCaptcha(); }

  cargarCaptcha() {
    this.cargandoCaptcha = true;
    this.captchaTexto    = '';
    this.authService.obtenerCaptcha().subscribe({
      next: (c) => {
        this.captchaId       = c.id_captcha;
        this.captchaImagen   = c.imagen;
        this.cargandoCaptcha = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.captchaImagen   = '';
        this.cargandoCaptcha = false;
        this.mensajeError    = 'No se pudo conectar con el servidor.';
        this.cdr.detectChanges();
      }
    });
  }

  iniciarSesion() {
    if (this.cargando) return;
    if (!this.correo || !this.contrasena) {
      this.mensajeError = 'Ingresa tu correo y contraseña.'; return;
    }
    if (!this.captchaTexto.trim()) {
      this.mensajeError = 'Escribe los caracteres de la imagen.'; return;
    }
    this.cargando = true;
    this.mensajeError = '';

    this.authService.login(this.correo, this.contrasena, this.captchaId, this.captchaTexto).subscribe({
      next: (res) => this.completarSesion(res),
      error: (e) => {
        this.cargando = false;
        const err = e.error || {};
        this.mensajeError = err.codigo === 'CAPTCHA_INVALIDO'
          ? 'Los caracteres de la imagen no coinciden. Prueba con la nueva imagen.'
          : e.status === 401
            ? 'Correo o contraseña incorrectos.'
            : e.status === 429
              ? err.error
              : 'Error al conectar con el servidor.';
        this.cargarCaptcha();
        this.cdr.detectChanges();
      }
    });
  }

  private completarSesion(res: any) {
    this.authService.guardarToken(res.token);
    localStorage.setItem('usuario_sgiv', JSON.stringify({
      id_usuario:      res.usuario.id_usuario,
      nombre_completo: res.usuario.nombre_completo,
      id_rol:          res.usuario.id_rol,
      id_sucursal:     res.usuario.id_sucursal,
      nombre_sucursal: res.usuario.nombre_sucursal
    }));

    // Cargar permisos antes de redirigir (si falla, igual se redirige)
    const ir = () => { this.cargando = false; this.router.navigate(['/dashboard']); };
    this.permisoService.cargarMisPermisos().subscribe({ next: ir, error: ir });
  }
}
