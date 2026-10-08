import { Component, inject, OnInit, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule, RefreshCw, ShieldCheck, Smartphone, ArrowLeft, Copy, Check } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { PermisoService } from '../../../core/services/permiso.service';

type Paso = 'credenciales' | 'configurar' | 'verificar';

interface DatosMfa { qr: string; secreto: string; emisor: string; cuenta: string; }

// ─── Login: CAPTCHA + contraseña, luego código de la app autenticadora ───
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule, LucideAngularModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  readonly icons = { refrescar: RefreshCw, escudo: ShieldCheck, celular: Smartphone, volver: ArrowLeft, copiar: Copy, copiado: Check };

  paso: Paso = 'credenciales';
  correo     = '';
  contrasena = '';
  mensajeError = '';
  cargando = false;

  // ─── CAPTCHA ───
  captchaId       = '';
  captchaImagen   = '';
  captchaTexto    = '';
  cargandoCaptcha = false;

  // ─── Segundo factor ───
  tokenMfa = '';
  codigo   = '';
  mfa: DatosMfa | null = null;
  copiado  = false;

  @ViewChild('campoCodigo') campoCodigo?: ElementRef<HTMLInputElement>;

  private authService    = inject(AuthService);
  private permisoService = inject(PermisoService);
  private router         = inject(Router);
  private route          = inject(ActivatedRoute);
  private cdr            = inject(ChangeDetectorRef);

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

  // ─── Paso 1 ───
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
      next: (res) => {
        this.cargando   = false;
        this.contrasena = '';
        this.tokenMfa   = res.token_mfa;
        this.codigo     = '';
        this.mfa        = res.paso === 'configurar_mfa' ? res.mfa : null;
        this.paso       = this.mfa ? 'configurar' : 'verificar';
        this.cdr.detectChanges();
        // En el primer ingreso no se enfoca: el teclado del celular taparía el QR
        if (this.paso === 'verificar') this.campoCodigo?.nativeElement.focus();
      },
      error: (e) => {
        this.cargando = false;
        const err = e.error || {};
        this.mensajeError = err.codigo === 'CAPTCHA_INVALIDO'
          ? 'Los caracteres de la imagen no coinciden. Prueba con la nueva imagen.'
          : e.status === 401
            ? 'Correo o contraseña incorrectos.'
            : e.status === 429 || e.status === 409
              ? err.error
              : 'Error al conectar con el servidor.';
        this.cargarCaptcha();
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Paso 2 ───
  alEscribirCodigo(valor: string) {
    this.codigo = (valor || '').replace(/\D/g, '').slice(0, 6);
    if (this.campoCodigo) this.campoCodigo.nativeElement.value = this.codigo;
    if (this.codigo.length === 6) this.verificarCodigo();
  }

  verificarCodigo() {
    if (this.cargando) return;
    if (!/^\d{6}$/.test(this.codigo)) {
      this.mensajeError = 'Ingresa los 6 dígitos que muestra la app.'; return;
    }
    this.cargando = true;
    this.mensajeError = '';

    this.authService.verificarMfa(this.tokenMfa, this.codigo).subscribe({
      next: (res) => this.completarSesion(res),
      error: (e) => {
        this.cargando = false;
        const err = e.error || {};
        if (err.codigo === 'MFA_CODIGO_INVALIDO') {
          this.mensajeError = 'Código incorrecto. Revisa que sea el de "SGIV Rickys" y que no haya cambiado.';
          this.codigo = '';
          this.cdr.detectChanges();
          this.campoCodigo?.nativeElement.focus();
          return;
        }
        this.volver(err.error || 'Error al conectar con el servidor.');
      }
    });
  }

  volver(mensaje = '') {
    this.paso     = 'credenciales';
    this.tokenMfa = '';
    this.mfa      = null;
    this.codigo   = '';
    this.copiado  = false;
    this.mensajeError = mensaje;
    this.cargarCaptcha();
    this.cdr.detectChanges();
  }

  get secretoAgrupado(): string {
    return this.mfa?.secreto.match(/.{1,4}/g)?.join(' ') ?? '';
  }

  get puedeCopiar(): boolean { return !!navigator.clipboard; }

  copiarSecreto() {
    if (!this.mfa) return;
    navigator.clipboard.writeText(this.mfa.secreto).then(() => {
      this.copiado = true;
      this.cdr.detectChanges();
      setTimeout(() => { this.copiado = false; this.cdr.detectChanges(); }, 2000);
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
