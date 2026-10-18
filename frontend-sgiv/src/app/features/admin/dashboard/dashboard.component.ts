import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, HostListener, viewChild } from '@angular/core';
import { Router, RouterOutlet, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LucideAngularModule,
         LayoutDashboard, Package, ShoppingCart,
         LayoutGrid, FileText, TrendingUp, Users,
         Landmark, LogOut, Building2, RefreshCw,
         Settings, Menu, X, Bell } from 'lucide-angular';
import { PermisoService } from '../../../core/services/permiso.service';
import { AuthService }    from '../../../core/services/auth.service';
import { SocketService }  from '../../../core/services/socket.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { BandejaPedidosComponent } from '../bandeja-pedidos/bandeja-pedidos.component';
import { HttpClient } from '@angular/common/http';
import { Subscription, filter } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { componenteDiferido } from '../../../core/utils/diferido';
import type { MensajeChat } from '../../shared/asistente/asistente-chat.component';

interface Enlace { ruta: string; texto: string; icono: any; modulo?: string }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule, LucideAngularModule, BandejaPedidosComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private router         = inject(Router);
  private permisoService = inject(PermisoService);
  private authService    = inject(AuthService);
  private socketService  = inject(SocketService);
  private cdr            = inject(ChangeDetectorRef);
  readonly ajustes       = inject(AjustesService);
  private http           = inject(HttpClient);

  // ─── Asistente con IA (se descarga solo si está activado) ───
  readonly chatAsistente = componenteDiferido(() => this.ajustes.config().ia_interno_disponible,
    () => import('../../shared/asistente/asistente-chat.component').then(m => m.AsistenteChatComponent));
  readonly preguntarAsistente = (mensajes: MensajeChat[]) =>
    this.http.post<{ respuesta: string }>(`${environment.apiUrl}/asistente`, { mensajes });

  usuario:        any  = null;
  esAdmin         = false;
  esCajero        = false;
  nombreSucursal  = '';

  /** Cache reactivo de permisos — se actualiza con permisos$ del service */
  permisosActuales: Record<string, boolean> = {};
  recargandoPermisos = false;
  toastPermisos: string | null = null;

  private subPermisos?: Subscription;
  private subRuta?: Subscription;

  /** Menú lateral abierto (solo en celular y tablet) */
  menuAbierto = false;
  readonly bandeja = viewChild(BandejaPedidosComponent);
  secciones: { titulo: string; enlaces: Enlace[] }[] = [];

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
    pedidos:    Bell,
    cerrar:     X,
    sucursal:   Building2,
    refresh:    RefreshCw,
    ajustes:    Settings
  };

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    if (raw) {
      this.usuario       = JSON.parse(raw);
      this.esAdmin       = this.usuario.id_rol === 1;
      this.esCajero      = this.usuario.id_rol === 2;
      this.nombreSucursal = this.usuario.nombre_sucursal || '';
    }
    this.secciones = this.armarMenu();

    // En celular el menú se cierra al cambiar de pantalla
    this.subRuta = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.cerrarMenu());

    // Inicializar cache con lo que haya en localStorage
    try {
      this.permisosActuales = JSON.parse(localStorage.getItem('permisos_sgiv') || '{}');
    } catch { this.permisosActuales = {}; }

    // Suscribirse a cambios de permisos (re-renderiza el sidebar)
    this.subPermisos = this.permisoService.permisos$.subscribe(p => {
      if (!p || Object.keys(p).length === 0) return;
      const previo = JSON.stringify(this.permisosActuales);
      const nuevo  = JSON.stringify(p);
      this.permisosActuales = p;
      this.cdr.detectChanges();
      if (previo !== nuevo && !this.esAdmin) {
        this.mostrarToast('Tus permisos fueron actualizados por el administrador.');
        this.salirSiPerdioAcceso();
      }
    });

    this.permisoService.escucharCambios();
  }

  ngOnDestroy() {
    this.subPermisos?.unsubscribe();
    this.subRuta?.unsubscribe();
    this.permisoService.dejarDeEscuchar();
  }

  // ─── Menú ───
  private armarMenu(): { titulo: string; enlaces: Enlace[] }[] {
    const i = this.icons;
    if (this.esAdmin) return [
      { titulo: 'Administración', enlaces: [
        { ruta: 'resumen',      texto: 'Panel principal', icono: i.dashboard },
        { ruta: 'inventario',   texto: 'Inventario',      icono: i.inventario },
        { ruta: 'reportes',     texto: 'Reportes',        icono: i.reportes },
        { ruta: 'cierres-caja', texto: 'Cierres de caja', icono: i.cierres }
      ]},
      { titulo: 'Sistema', enlaces: [
        { ruta: 'usuarios', texto: 'Usuarios', icono: i.usuarios },
        { ruta: 'ajustes',  texto: 'Ajustes',  icono: i.ajustes }
      ]}
    ];
    if (this.esCajero) return [
      { titulo: 'Operaciones', enlaces: [
        { ruta: 'resumen',     texto: 'Panel principal', icono: i.dashboard,  modulo: 'dashboard' },
        { ruta: 'punto-venta', texto: 'Punto de venta',  icono: i.pos,        modulo: 'punto_venta' },
        { ruta: 'mesas',       texto: 'Mesas',           icono: i.mesas,      modulo: 'mesas' },
        { ruta: 'arqueo',      texto: 'Arqueo de caja',  icono: i.arqueo,     modulo: 'arqueo' },
        { ruta: 'inventario',  texto: 'Inventario',      icono: i.inventario, modulo: 'inventario' },
        { ruta: 'reportes',    texto: 'Reportes',        icono: i.reportes,   modulo: 'reportes' },
        { ruta: 'usuarios',    texto: 'Usuarios',        icono: i.usuarios,   modulo: 'usuarios' }
      ]}
    ];
    return [];
  }

  /** Preguntas de ejemplo según lo que el usuario puede ver */
  get sugerenciasAsistente(): string[] {
    if (this.esAdmin) return ['¿Cómo van las ventas hoy?', '¿Qué productos tienen stock bajo?',
                              '¿Cuánto vendimos este mes?', '¿Cómo registro una merma?'];
    return [
      this.tiene('dashboard') && '¿Cómo van las ventas hoy?',
      this.tiene('mesas') && '¿Hay pedidos QR pendientes?',
      (this.tiene('arqueo') || this.tiene('punto_venta')) && '¿Cuánto efectivo debería tener en caja?',
      (this.tiene('inventario') || this.tiene('punto_venta')) && '¿Qué productos están por agotarse?',
      this.tiene('mesas') ? '¿Cómo cobro una mesa?' : '¿Cómo cierro mi caja?'
    ].filter((s): s is string => !!s).slice(0, 4);
  }

  abrirBandeja() {
    this.cerrarMenu();
    this.bandeja()?.alternar();
  }

  cerrarMenu() {
    if (!this.menuAbierto) return;
    this.menuAbierto = false;
    this.cdr.detectChanges();
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape() { this.cerrarMenu(); }

  tiene(modulo: string): boolean {
    if (this.esAdmin) return true;
    // Usar el cache reactivo si está poblado, sino fallback al service
    if (Object.keys(this.permisosActuales).length > 0) {
      return this.permisosActuales[modulo] === true;
    }
    return this.permisoService.tienePermiso(modulo);
  }

  private salirSiPerdioAcceso() {
    const ruta = this.router.url.split(/[/?#]/)[2];
    const enlace = this.secciones.flatMap(s => s.enlaces).find(e => e.ruta === ruta);
    if (enlace?.modulo && !this.tiene(enlace.modulo)) this.router.navigate(['/dashboard/sin-acceso']);
  }

  /** Botón manual de recarga (cajero) */
  recargarPermisos() {
    if (this.recargandoPermisos) return;
    this.recargandoPermisos = true;
    this.permisoService.recargarPermisos().subscribe({
      next: () => {
        this.recargandoPermisos = false;
        this.mostrarToast('Permisos actualizados.');
        this.cdr.detectChanges();
      },
      error: () => {
        this.recargandoPermisos = false;
        this.mostrarToast('No se pudieron recargar los permisos.');
        this.cdr.detectChanges();
      }
    });
  }

  private mostrarToast(msg: string) {
    this.toastPermisos = msg;
    this.cdr.detectChanges();
    setTimeout(() => { this.toastPermisos = null; this.cdr.detectChanges(); }, 4000);
  }

  cerrarSesion() {
    this.authService.cerrarSesion(true);
    this.permisoService.limpiarPermisos();
    this.socketService.desconectar();
    this.router.navigate(['/login']);
  }
}