import { AfterViewInit, Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideAngularModule, RefreshCw, Eye, EyeOff, Send, ArrowLeft } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import { PermisoService } from '../../../core/services/permiso.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SesionService } from '../../../core/services/sesion.service';
import { enfocar, pantallaTactil, pasarAlSiguienteVacio } from '../../../core/directives/fondo-modal.directive';

// ─── Login: correo y contraseña; luego código de Telegram (o CAPTCHA sin Telegram) ───
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule, LucideAngularModule],
  templateUrl: './login.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './login.component.css']
})
export class LoginComponent implements OnInit, AfterViewInit {
  readonly icons = { refrescar: RefreshCw, ver: Eye, ocultar: EyeOff, telegram: Send, volver: ArrowLeft };

  // ─── Paso 2: código de Telegram o, si Telegram no respondió, CAPTCHA ───
  readonly paso       = signal<'datos' | 'codigo' | 'alterno'>('datos');
  private idDesafio   = '';
  readonly codigo     = signal('');
  readonly telefono   = signal('');
  readonly esperaReenvio = signal(0);
  private reloj?: ReturnType<typeof setInterval>;

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
  private destruir       = inject(DestroyRef);

  /** Correo de la sesión que venció: se deja escrito para que vuelva a entrar la misma persona */
  private correoAnterior = '';
  private escribio = false;

  constructor() {
    // Redirigido por el interceptor: token vencido o usuario desactivado
    if (this.route.snapshot.queryParamMap.get('sesion') === 'expirada') {
      const antes = this.router.currentNavigation()?.extras.state as { nombre?: string; correo?: string } | undefined;
      this.mensajeError.set(antes?.nombre
        ? `La sesión de ${antes.nombre} terminó. Vuelve a ingresar con tu cuenta.`
        : 'Tu sesión terminó o tu usuario fue desactivado. Inicia sesión nuevamente.');
      if (antes?.correo) {
        this.correoAnterior = antes.correo;
        this.correo.set(antes.correo);
        // Si el navegador rellena otra cuenta guardada, se vuelve a poner este correo
        for (const ms of [300, 1000]) setTimeout(() => this.restaurarCorreo(), ms);
      }
    }
  }

  private restaurarCorreo() {
    if (this.escribio || this.correo() === this.correoAnterior) return;
    this.correo.set(this.correoAnterior);
    this.contrasena.set('');
  }

  /** El usuario tocó el teclado: ya no se corrige el correo */
  marcarEscritura() { this.escribio = true; }

  /** El servidor pidió CAPTCHA aunque la copia local de los ajustes dijera que no */
  private readonly forzarCaptcha = signal(false);

  readonly titulo = computed(() => this.ajustes.config().login_titulo || this.ajustes.nombre());

  // Con Telegram el CAPTCHA aparece solo si el servidor lo pide (usuario sin Telegram vinculado)
  readonly usaCaptcha = computed(() =>
    (this.ajustes.config().captcha_activo && !this.ajustes.config().telegram_activo) || this.forzarCaptcha());

  @ViewChild('campoCorreo') campoCorreo?: ElementRef<HTMLInputElement>;

  ngOnInit() {
    if (this.usaCaptcha()) this.cargarCaptcha();
    this.destruir.onDestroy(() => clearInterval(this.reloj));
  }

  ngAfterViewInit() {
    if (pantallaTactil()) return;
    enfocar(this.correoAnterior ? document.getElementById('contrasena') : this.campoCorreo?.nativeElement);
  }

  /** Enter pasa al siguiente campo vacío; con todo lleno, entra */
  siguienteCampo(evento: Event, formulario: HTMLElement) { pasarAlSiguienteVacio(evento, formulario); }

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
      next: (res) => this.siguientePaso(res),
      error: (e) => {
        this.cargando.set(false);
        const err = e.error || {};
        if (err.codigo === 'CAPTCHA_INVALIDO' || err.codigo === 'CAPTCHA_REQUERIDO') this.forzarCaptcha.set(true);
        this.mensajeError.set(err.codigo === 'CAPTCHA_REQUERIDO'
          ? 'Escribe los caracteres de la imagen.'
          : err.codigo === 'CAPTCHA_INVALIDO'
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

  /** Respuesta del paso 1: sesión iniciada, código enviado o CAPTCHA alterno */
  private siguientePaso(res: any) {
    if (res.requiere_codigo) {
      this.idDesafio = res.id_desafio;
      this.telefono.set(res.telefono || '');
      this.codigo.set('');
      this.paso.set('codigo');
      this.contarReenvio();
      return this.listo();
    }
    if (res.requiere_captcha) {
      this.idDesafio = res.id_desafio;
      this.paso.set('alterno');
      this.mensajeError.set('Telegram no respondió. Escribe los caracteres de la imagen.');
      this.cargarCaptcha();
      return this.listo();
    }
    this.completarSesion(res);
  }

  private listo() {
    this.cargando.set(false);
    setTimeout(() => enfocar(document.getElementById(this.paso() === 'codigo' ? 'codigo' : 'captcha')));
  }

  /** El código se envía solo al completar los 6 dígitos */
  escribirCodigo(valor: string) {
    const limpio = String(valor || '').replace(/\D/g, '').slice(0, 6);
    this.codigo.set(limpio);
    if (limpio.length === 6) this.enviarCodigo();
  }

  enviarCodigo() {
    if (this.cargando()) return;
    if (this.codigo().length !== 6) return this.mensajeError.set('Escribe los 6 dígitos del código.');
    this.cargando.set(true);
    this.mensajeError.set('');
    this.authService.verificarCodigo(this.idDesafio, this.codigo()).subscribe({
      next: (res) => this.completarSesion(res),
      error: (e) => this.errorPaso2(e)
    });
  }

  enviarAlterno() {
    if (this.cargando()) return;
    if (!this.captchaTexto().trim()) return this.mensajeError.set('Escribe los caracteres de la imagen.');
    this.cargando.set(true);
    this.mensajeError.set('');
    this.authService.verificarAlterno(this.idDesafio, this.captchaId, this.captchaTexto()).subscribe({
      next: (res) => this.completarSesion(res),
      error: (e) => { this.errorPaso2(e); if (this.paso() === 'alterno') this.cargarCaptcha(); }
    });
  }

  reenviar() {
    if (this.esperaReenvio() > 0 || this.cargando()) return;
    this.mensajeError.set('');
    this.authService.reenviarCodigo(this.idDesafio).subscribe({
      next: (res) => this.siguientePaso(res),
      error: (e) => this.errorPaso2(e)
    });
  }

  private errorPaso2(e: any) {
    this.cargando.set(false);
    const err = e.error || {};
    this.codigo.set('');
    this.mensajeError.set(err.error || 'Error al conectar con el servidor.');
    // Vencido o agotado: vuelve a pedir la contraseña
    if (e.status === 410 || err.codigo === 'AGOTADO') this.volver(false);
    else setTimeout(() => enfocar(document.getElementById(this.paso() === 'codigo' ? 'codigo' : 'captcha')));
  }

  volver(limpiarMensaje = true) {
    clearInterval(this.reloj);
    this.paso.set('datos');
    this.idDesafio = '';
    this.contrasena.set('');
    if (limpiarMensaje) this.mensajeError.set('');
    if (this.usaCaptcha()) this.cargarCaptcha();
    setTimeout(() => enfocar(document.getElementById('contrasena')));
  }

  private contarReenvio() {
    clearInterval(this.reloj);
    this.esperaReenvio.set(30);
    this.reloj = setInterval(() => {
      this.esperaReenvio.update(s => Math.max(0, s - 1));
      if (!this.esperaReenvio()) clearInterval(this.reloj);
    }, 1000);
  }

  private completarSesion(res: any) {
    clearInterval(this.reloj);
    this.sesion.iniciar(res.usuario);

    // Cargar permisos antes de redirigir (si falla, igual se redirige)
    const ir = () => { this.cargando.set(false); this.router.navigate(['/dashboard']); };
    this.permisoService.cargarMisPermisos().subscribe({ next: ir, error: ir });
  }
}
