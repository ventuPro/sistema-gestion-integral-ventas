import { Component, computed, inject, OnInit, OnDestroy, HostListener, signal, viewChild } from '@angular/core';
import { Router, RouterOutlet, RouterModule, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LucideAngularModule,
         LayoutDashboard, Package, ShoppingCart,
         LayoutGrid, FileText, TrendingUp, Users,
         Landmark, LogOut, Building2,
         Settings, Menu, X, Bell, BadgePercent } from 'lucide-angular';
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
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService } from '../../../core/services/sesion.service';

interface Enlace { ruta: string; texto: string; icono: any; modulo?: string }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterModule, CommonModule, LucideAngularModule, BandejaPedidosComponent],
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
  private subTransferencias?: Subscription;
  private subCierre?: Subscription;

  /** Menú lateral abierto (solo en celular y tablet) */
  readonly menuAbierto = signal(false);
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
    pedidos:    Bell,
    cerrar:     X,
    sucursal:   Building2,
    ajustes:    Settings,
    promociones: BadgePercent
  };

  ngOnInit() {
    // En celular el menú se cierra al cambiar de pantalla
    this.subRuta = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.cerrarMenu());

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
    this.avisarTransferencias();
  }

  /** Aviso a la sucursal que recibe productos (y al administrador), en cualquier pantalla */
  private avisarTransferencias() {
    this.socketService.conectar('cajeros');
    this.subTransferencias = this.socketService.escuchar<any>('transferencia:nueva').subscribe(d => {
      const yo = this.usuario();
      if (!d || !yo || Number(d.id_usuario) === Number(yo.id_usuario)) return;
      if (this.esAdmin())
        this.dialogo.avisar(`Transferencia de ${d.nombre_origen} a ${d.nombre_destino}: ${d.resumen}`);
      else if (Number(d.id_sucursal_destino) === this.sesion.idSucursal())
        this.dialogo.avisar(`Llegaron productos de ${d.nombre_origen}: ${d.resumen}`);
    });
    this.subCierre = this.socketService.escuchar<any>('caja:cerrada').subscribe(d => {
      if (d?.por === 'Sistema' && Number(d.id_usuario) === this.usuario()?.id_usuario)
        this.dialogo.avisar('El sistema cerró tu caja a las 00:00.');
    });
  }

  ngOnDestroy() {
    this.subPermisos?.unsubscribe();
    this.subRuta?.unsubscribe();
    this.subTransferencias?.unsubscribe();
    this.subCierre?.unsubscribe();
    this.permisoService.dejarDeEscuchar();
  }

  // ─── Menú ───
  private armarMenu(): { titulo: string; enlaces: Enlace[] }[] {
    const i = this.icons;
    if (this.esAdmin()) return [
      { titulo: 'Administración', enlaces: [
        { ruta: 'resumen',      texto: 'Panel principal', icono: i.dashboard },
        { ruta: 'inventario',   texto: 'Inventario',      icono: i.inventario },
        { ruta: 'reportes',     texto: 'Reportes',        icono: i.reportes },
        { ruta: 'promociones',  texto: 'Promociones',     icono: i.promociones },
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
  alPresionarEscape() { this.cerrarMenu(); }

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
    this.authService.cerrarSesion(true);
    this.permisoService.limpiarPermisos();
    this.socketService.desconectar();
    this.router.navigate(['/login']);
  }
}