import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule, RefreshCw, Eye, EyeOff } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { PermisoService } from '../../../core/services/permiso.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SesionService } from '../../../core/services/sesion.service';

// ─── Login: correo, contraseña y CAPTCHA ───
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule, LucideAngularModule],
  templateUrl: './login.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './login.component.css']
})
export class LoginComponent implements OnInit {
  readonly icons = { refrescar: RefreshCw, ver: Eye, ocultar: EyeOff };

  readonly correo        = signal('');
  readonly contrasena    = signal('');
  readonly mensajeError  = signal('');
  readonly cargando      = signal(false);
  readonly verContrasena = signal(false);

  // ─── CAPTCHA ───
  private captchaId       = '';
  readonly captchaImagen   = signal('');
  readonly captchaTexto    = signal('');
  readonly cargandoCaptcha = signal(false);

  private authService    = inject(AuthService);
  private permisoService = inject(PermisoService);
  private router         = inject(Router);
  private sesion         = inject(SesionService);
  private route          = inject(ActivatedRoute);
  readonly ajustes       = inject(AjustesService);

  constructor() {
    // Redirigido por el interceptor: token vencido o usuario desactivado
    if (this.route.snapshot.queryParamMap.get('sesion') === 'expirada') {
      this.mensajeError.set('Tu sesión terminó o tu usuario fue desactivado. Inicia sesión nuevamente.');
    }
  }

  /** El servidor pidió CAPTCHA aunque la copia local de los ajustes dijera que no */
  private readonly forzarCaptcha = signal(false);

  readonly titulo = computed(() => this.ajustes.config().login_titulo || this.ajustes.nombre());

  readonly usaCaptcha = computed(() => this.ajustes.config().captcha_activo || this.forzarCaptcha());

  ngOnInit() { if (this.usaCaptcha()) this.cargarCaptcha(); }

  cargarCaptcha() {
    this.cargandoCaptcha.set(true);
    this.captchaTexto.set('');
    this.authService.obtenerCaptcha().subscribe({
      next: (c) => {
        this.captchaId = c.id_captcha;
        this.captchaImagen.set(c.imagen);
        this.cargandoCaptcha.set(false);
      },
      error: () => {
        this.captchaImagen.set('');
        this.cargandoCaptcha.set(false);
        this.mensajeError.set('No se pudo conectar con el servidor.');
      }
    });
  }

  iniciarSesion() {
    if (this.cargando()) return;
    if (!this.correo() || !this.contrasena()) return this.mensajeError.set('Ingresa tu correo y contraseña.');
    if (this.usaCaptcha() && !this.captchaTexto().trim()) return this.mensajeError.set('Escribe los caracteres de la imagen.');
    this.cargando.set(true);
    this.mensajeError.set('');

    this.authService.login(this.correo(), this.contrasena(), this.captchaId, this.captchaTexto()).subscribe({
      next: (res) => this.completarSesion(res),
      error: (e) => {
        this.cargando.set(false);
        const err = e.error || {};
        if (err.codigo === 'CAPTCHA_INVALIDO') this.forzarCaptcha.set(true);
        this.mensajeError.set(err.codigo === 'CAPTCHA_INVALIDO'
          ? 'Los caracteres de la imagen no coinciden. Prueba con la nueva imagen.'
          : e.status === 401
            ? 'Correo o contraseña incorrectos.'
            : e.status === 429
              ? err.error
              : 'Error al conectar con el servidor.');
        if (this.usaCaptcha()) this.cargarCaptcha();
      }
    });
  }

  private completarSesion(res: any) {
    this.sesion.iniciar(res.usuario);

    // Cargar permisos antes de redirigir (si falla, igual se redirige)
    const ir = () => { this.cargando.set(false); this.router.navigate(['/dashboard']); };
    this.permisoService.cargarMisPermisos().subscribe({ next: ir, error: ir });
  }
}
