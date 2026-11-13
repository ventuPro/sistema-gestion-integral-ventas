import { Component, computed, effect, inject, OnInit, OnDestroy, HostListener, signal, viewChild } from '@angular/core';
import { Router, RouterOutlet, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LucideAngularModule,
         LayoutDashboard, Package, ShoppingCart,
         LayoutGrid, FileText, TrendingUp, Users,
         Landmark, LogOut, Building2,
         Settings, Menu, X, Bell, BadgePercent, ChevronsUpDown, Calculator, PanelLeftClose, PanelLeftOpen, CircleUser, QrCode, CakeSlice } from 'lucide-angular';
import { PermisoService } from '../../../core/services/permiso.service';
import { AuthService }    from '../../../core/services/auth.service';
import { SocketService }  from '../../../core/services/socket.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { BandejaPedidosComponent } from '../bandeja-pedidos/bandeja-pedidos.component';
import { HttpClient } from '@angular/common/http';
import { Subscription, filter, merge } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { componenteDiferido } from '../../../core/utils/diferido';
import type { MensajeChat } from '../../shared/asistente/asistente-chat.component';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';
import { NotificacionService } from '../../../core/services/notificacion.service';
import { PanelNotificacionesComponent } from '../../shared/notificaciones/panel-notificaciones.component';
import { AvisoEncargosComponent } from '../encargos/aviso-encargos.component';
import { Encargo, EncargoService } from '../../../core/services/encargo.service';

const CLAVE_PLEGADO = 'menu_plegado';
const leerPlegado = () => { try { return localStorage.getItem(CLAVE_PLEGADO) === '1'; } catch { return false; } };

interface Enlace { ruta: string; texto: string; icono: any; modulo?: string }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule, LucideAngularModule, BandejaPedidosComponent, PanelNotificacionesComponent, AvisoEncargosComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  private router         = inject(Router);
  private dialogo        = inject(DialogoService);
  private permisoService = inject(PermisoService);
  private authService    = inject(AuthService);
  private socketService  = inject(SocketService);
  readonly ajustes       = inject(AjustesService);
  private http           = inject(HttpClient);
  readonly notificaciones = inject(NotificacionService);
  private encargoService = inject(EncargoService);

  // ─── Asistente con IA (se descarga solo si está activado) ───
  readonly chatAsistente = componenteDiferido(() => this.ajustes.config().ia_interno_disponible,
    () => import('../../shared/asistente/asistente-chat.component').then(m => m.AsistenteChatComponent));
  readonly preguntarAsistente = (mensajes: MensajeChat[]) =>
    this.http.post<{ respuesta: string }>(`${environment.apiUrl}/asistente`, { mensajes });

  readonly usuario        = this.sesion.usuario;
  readonly esAdmin        = this.sesion.esAdmin;
  readonly esCajero       = this.sesion.esCajero;
  readonly nombreSucursal = computed(() => this.usuario()?.nombre_sucursal || '');
  readonly saludoAsistente = computed(() => {
    const nombre = this.usuario()?.nombre_completo?.split(' ')[0];
    return `¡Hola${nombre ? ', ' + nombre : ''}! Pregúntame por ventas, stock, pedidos o cómo hacer algo en el sistema.`;
  });

  /** Cache reactivo de permisos — se actualiza con permisos$ del service */
  readonly permisosActuales   = signal<Record<string, boolean>>({});

  private subPermisos?: Subscription;
  private subRuta?: Subscription;

  /** Encargos de hoy: se muestran una vez al día por usuario (al primer ingreso) */
  readonly encargosHoy = signal<Encargo[]>([]);

  /** Panel de la campana */
  readonly panelNotificaciones = signal(false);
  /** Pantallas del menú a las que puede entrar (enlaces de las notificaciones) */
  readonly rutasPermitidas = computed(() => new Set(this.secciones().flatMap(s => s.enlaces)
    .filter(e => !e.modulo || this.tiene(e.modulo)).map(e => e.ruta)));

  /** Menú lateral abierto (solo en celular y tablet) */
  readonly menuAbierto = signal(false);
  /** Menú de la cuenta (abajo en la barra lateral) */
  readonly menuCuenta = signal(false);
  /** En Punto de venta el Asistente va abajo a la izquierda para no tapar «Cobrar» */
  readonly enPuntoVenta = signal(false);

  // ─── Menú lateral plegado (solo íconos, en escritorio): igual en todas las pantallas, se recuerda en este equipo ───
  readonly plegado = signal(leerPlegado());

  // El botón del Asistente en Punto de venta se ubica después del menú
  private readonly anchoMenu = effect(() =>
    document.documentElement.style.setProperty('--ancho-lateral', this.plegado() ? '72px' : '260px'));

  alternarMenu() {
    this.menuCuenta.set(false);
    const plegado = !this.plegado();
    this.plegado.set(plegado);
    try { localStorage.setItem(CLAVE_PLEGADO, plegado ? '1' : '0'); } catch { }
  }
  readonly bandeja = viewChild(BandejaPedidosComponent);
  readonly secciones = computed(() => this.armarMenu());

  // Iconos
  readonly icons = {
    dashboard:  LayoutDashboard,
    inventario: Package,
    pos:        ShoppingCart,
    mesas:      LayoutGrid,
    arqueo:     FileText,
    reportes:   TrendingUp,
    usuarios:   Users,
    cierres:    Landmark,
    logout:     LogOut,
    menu:       Menu,
    pedidos:    QrCode,
    campana:    Bell,
    cerrar:     X,
    sucursal:   Building2,
    ajustes:    Settings,
    promociones: BadgePercent,
    encargos:   CakeSlice,
    cuenta:     ChevronsUpDown,
    costos:     Calculator,
    plegar:     PanelLeftClose,
    desplegar:  PanelLeftOpen,
    usuario:    CircleUser
  };

  ngOnInit() {
    // En celular el menú se cierra al cambiar de pantalla
    this.enPuntoVenta.set(this.router.url.startsWith('/dashboard/punto-venta'));
    this.subRuta = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.cerrarMenu();
      this.enPuntoVenta.set(this.router.url.startsWith('/dashboard/punto-venta'));
    });

    // Inicializar cache con lo que haya en localStorage
    try {
      this.permisosActuales.set(JSON.parse(localStorage.getItem('permisos_sgiv') || '{}'));
    } catch { this.permisosActuales.set({}); }

    // Suscribirse a cambios de permisos (re-renderiza el sidebar)
    this.subPermisos = this.permisoService.permisos$.subscribe(p => {
      if (!p || Object.keys(p).length === 0) return;
      const previo = JSON.stringify(this.permisosActuales());
      const nuevo  = JSON.stringify(p);
      this.permisosActuales.set(p);
      if (previo !== nuevo && !this.esAdmin()) {
        this.dialogo.avisar('Tus permisos fueron actualizados por el administrador.');
        this.salirSiPerdioAcceso();
      }
    });

    this.permisoService.escucharCambios();
    // Las notificaciones llegan a la sala propia del usuario (se une con 'cajeros')
    this.socketService.conectar('cajeros');
    this.notificaciones.iniciar();
    this.revisarEncargosDelDia();

    // Nombre y sucursal al día en el menú de la cuenta: al entrar, al reconectar y cuando el administrador lo edita
    this.refrescarPerfil();
    this.subPerfil = merge(this.socketService.reconexiones, this.socketService.escuchar('sala_unida')).subscribe(() => this.refrescarPerfil());
    this.subPerfil.add(this.socketService.escuchar<any>('usuario:actualizado').subscribe(d => this.sesion.actualizar(d || {})));
  }

  private subPerfil?: Subscription;

  private refrescarPerfil() {
    this.http.get<any>(`${environment.apiUrl}/usuarios/perfil`).subscribe({
      next: (p) => this.sesion.actualizar({ nombre_completo: p.nombre_completo, correo_electronico: p.correo_electronico,
                                           nombre_sucursal: p.nombre_sucursal }),
      error: () => {}
    });
  }

  // ─── Encargos para hoy ───
  private claveEncargos() { return `aviso_encargos_${this.usuario()?.id_usuario}`; }

  private revisarEncargosDelDia() {
    const hoy = new Date().toLocaleDateString('en-CA');
    try { if (localStorage.getItem(this.claveEncargos()) === hoy) return; } catch { }
    // Los permisos guardados en el equipo pueden ser de antes del módulo: solo se omite si dicen que no
    if (this.permisosActuales()['encargos'] === false && !this.esAdmin()) return;
    this.encargoService.deHoy().subscribe({ next: (l) => this.encargosHoy.set(l || []), error: () => {} });
  }

  cerrarEncargosHoy(ver = false) {
    try { localStorage.setItem(this.claveEncargos(), new Date().toLocaleDateString('en-CA')); } catch { }
    this.encargosHoy.set([]);
    if (ver) this.router.navigate(['/dashboard/encargos']);
  }

  abrirNotificaciones() {
    this.cerrarMenu();
    this.menuCuenta.set(false);
    this.panelNotificaciones.set(true);
  }

  ngOnDestroy() {
    this.subPermisos?.unsubscribe();
    this.subRuta?.unsubscribe();
    this.subPerfil?.unsubscribe();
    this.notificaciones.detener();
    this.permisoService.dejarDeEscuchar();
  }

  // ─── Menú ───
  private armarMenu(): { titulo: string; enlaces: Enlace[] }[] {
    const i = this.icons;
    if (this.esAdmin()) return [
      { titulo: 'Administración', enlaces: [
        { ruta: 'resumen',      texto: 'Panel principal', icono: i.dashboard },
        { ruta: 'inventario',   texto: 'Inventario',      icono: i.inventario },
        { ruta: 'encargos',     texto: 'Encargos',        icono: i.encargos },
        { ruta: 'reportes',     texto: 'Reportes',        icono: i.reportes },
        { ruta: 'promociones',  texto: 'Promociones',     icono: i.promociones },
        { ruta: 'costos',       texto: 'Costos',          icono: i.costos },
        { ruta: 'cierres-caja', texto: 'Cierres de caja', icono: i.cierres }
      ]},
      { titulo: 'Sistema', enlaces: [
        { ruta: 'usuarios', texto: 'Usuarios', icono: i.usuarios },
        { ruta: 'ajustes',  texto: 'Ajustes',  icono: i.ajustes }
      ]}
    ];
    if (this.esCajero()) return [
      { titulo: 'Operaciones', enlaces: [
        { ruta: 'resumen',     texto: 'Panel principal', icono: i.dashboard,  modulo: 'dashboard' },
        { ruta: 'punto-venta', texto: 'Punto de venta',  icono: i.pos,        modulo: 'punto_venta' },
        { ruta: 'mesas',       texto: 'Mesas',           icono: i.mesas,      modulo: 'mesas' },
        { ruta: 'arqueo',      texto: 'Arqueo de caja',  icono: i.arqueo,     modulo: 'arqueo' },
        { ruta: 'encargos',    texto: 'Encargos',        icono: i.encargos,   modulo: 'encargos' },
        { ruta: 'inventario',  texto: 'Inventario',      icono: i.inventario, modulo: 'inventario' },
        { ruta: 'reportes',    texto: 'Reportes',        icono: i.reportes,   modulo: 'reportes' },
        { ruta: 'promociones', texto: 'Promociones',     icono: i.promociones, modulo: 'promociones' },
        { ruta: 'usuarios',    texto: 'Usuarios',        icono: i.usuarios,   modulo: 'usuarios' }
      ]}
    ];
    return [];
  }

  /** Preguntas de ejemplo según lo que el usuario puede ver */
  readonly sugerenciasAsistente = computed<string[]>(() => {
    if (this.esAdmin()) return ['¿Cómo van las ventas hoy?', '¿Qué productos tienen stock bajo?',
                              '¿Cuánto vendimos este mes?', '¿Cómo registro una merma?'];
    return [
      this.tiene('dashboard') && '¿Cómo van las ventas hoy?',
      this.tiene('mesas') && '¿Hay pedidos QR pendientes?',
      (this.tiene('arqueo') || this.tiene('punto_venta')) && '¿Cuánto efectivo debería tener en caja?',
      (this.tiene('inventario') || this.tiene('punto_venta')) && '¿Qué productos están por agotarse?',
      this.tiene('mesas') ? '¿Cómo cobro una mesa?' : '¿Cómo cierro mi caja?'
    ].filter((s): s is string => !!s).slice(0, 4);
  });

  abrirBandeja() {
    this.cerrarMenu();
    this.bandeja()?.alternar();
  }

  cerrarMenu() {
    this.menuAbierto.set(false);
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape() { this.cerrarMenu(); this.menuCuenta.set(false); }

  tiene(modulo: string): boolean {
    if (this.esAdmin()) return true;
    // Usar el cache reactivo si está poblado, sino fallback al service
    const permisos = this.permisosActuales();
    if (Object.keys(permisos).length > 0) return permisos[modulo] === true;
    return this.permisoService.tienePermiso(modulo);
  }

  private salirSiPerdioAcceso() {
    const ruta = this.router.url.split(/[/?#]/)[2];
    const enlace = this.secciones().flatMap(s => s.enlaces).find(e => e.ruta === ruta);
    if (enlace?.modulo && !this.tiene(enlace.modulo)) this.router.navigate(['/dashboard/sin-acceso']);
  }

  cerrarSesion() {
    this.menuCuenta.set(false);
    this.authService.cerrarSesion(true);
    this.permisoService.limpiarPermisos();
    this.socketService.desconectar();
    this.router.navigate(['/login']);
  }
}