import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { UsuarioService } from '../../../core/services/usuario.service';
import { PermisoService, MODULOS } from '../../../core/services/permiso.service';
import { CajaService } from '../../../core/services/caja.service';
import { ConfirmacionComponent } from '../../shared/confirmacion/confirmacion.component';
import { LucideAngularModule,
         Pencil, KeyRound, ShieldCheck, Lock, Unlock,
         UserCheck, UserX, X, Plus, Search } from 'lucide-angular';
import { DialogoService } from '../../../core/services/dialogo.service';
import { SesionService, ROL } from '../../../core/services/sesion.service';

interface Confirmacion {
  titulo:  string;
  mensaje: string;
  boton:   string;
  peligro: boolean;
  accion:  () => Observable<any>;
  exito:   (res: any) => string;
}

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ConfirmacionComponent],
  templateUrl: './usuarios.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './usuarios.component.css']
})
export class UsuariosComponent implements OnInit {
  private readonly sesion = inject(SesionService);
  private usuarioService = inject(UsuarioService);
  private dialogo        = inject(DialogoService);
  private permisoService = inject(PermisoService);
  private cajaService    = inject(CajaService);

  readonly icons = {
    edit:        Pencil,
    password:    KeyRound,
    permissions: ShieldCheck,
    cajaOpen:    Unlock,
    cajaClose:   Lock,
    activate:    UserCheck,
    deactivate:  UserX,
    close:       X,
    plus:        Plus,
    search:      Search
  };

  readonly ROL = ROL;

  readonly listaUsuarios   = signal<any[]>([]);
  readonly listaRoles      = signal<any[]>([]);
  readonly listaSucursales = signal<any[]>([]);
  readonly cargando     = signal(true);
  readonly guardando    = signal(false);
  readonly busqueda     = signal('');
  readonly filtroEstado = signal<'todos' | 'activos' | 'inactivos'>('activos');

  readonly usuariosFiltrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase(), estado = this.filtroEstado();
    return this.listaUsuarios().filter(u =>
      (estado === 'todos' || (estado === 'activos') === !!u.estado_activo) &&
      (!texto || `${u.nombre_completo} ${u.correo_electronico}`.toLowerCase().includes(texto))
    );
  });

  // Formularios de los modales: se reemplazan con set(); el template edita los campos del objeto actual

  // Modal CRUD
  readonly mostrarModal = signal(false);
  readonly editandoId   = signal<number | null>(null);
  readonly mensajeError = signal('');
  readonly formulario   = signal<any>({ nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' });

  // Modal cambio contraseña
  readonly mostrarModalContrasena = signal(false);
  readonly usuarioContrasena      = signal<any>(null);
  readonly cambioContrasena       = signal({ nueva: '', confirmar: '' });
  readonly errorContrasena        = signal('');
  readonly cargandoContrasena     = signal(false);

  // Modal permisos
  readonly mostrarModalPermisos = signal(false);
  readonly usuarioPermisos      = signal<any>(null);
  readonly permisosEdicion      = signal<Record<string, boolean>>({});
  readonly cargandoPermisos     = signal(false);
  readonly modulosCargados      = signal(false);
  readonly errorPermisos        = signal('');
  readonly modulosSistema       = MODULOS;

  // Confirmaciones (desactivar, reactivar, caja)
  readonly confirmacion      = signal<Confirmacion | null>(null);
  readonly confirmando       = signal(false);
  readonly errorConfirmacion = signal('');

  ngOnInit() { this.cargarDatos(); }

  cargarDatos() {
    this.cargando.set(true);
    this.usuarioService.obtenerDatosFormulario().subscribe({
      next: (d) => { this.listaRoles.set(d.roles); this.listaSucursales.set(d.sucursales); }
    });
    this.usuarioService.listarUsuarios().subscribe({
      next: (u) => { this.listaUsuarios.set(u); this.cargando.set(false); },
      error: () => this.cargando.set(false)
    });
  }

  esYo(usr: any): boolean { return Number(usr.id_usuario) === this.sesion.usuario()?.id_usuario; }

  // ─── Modal CRUD ───
  abrirModalNuevo() {
    this.editandoId.set(null); this.mensajeError.set(''); this.guardando.set(false);
    this.formulario.set({ nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' });
    this.mostrarModal.set(true);
  }

  abrirModalEditar(usr: any) {
    this.editandoId.set(usr.id_usuario); this.mensajeError.set(''); this.guardando.set(false);
    this.formulario.set({
      nombre_completo: usr.nombre_completo, correo_electronico: usr.correo_electronico,
      contrasena: '', id_rol: Number(usr.id_rol), id_sucursal: Number(usr.id_sucursal)
    });
    this.mostrarModal.set(true);
  }

  cerrarModal() { this.mostrarModal.set(false); this.editandoId.set(null); this.mensajeError.set(''); }

  guardarUsuario() {
    const f = this.formulario(), id = this.editandoId();
    if (!f.nombre_completo || !f.correo_electronico || !f.id_rol || !f.id_sucursal)
      return this.mensajeError.set('Completa todos los campos.');
    if (!id && (f.contrasena || '').length < 6)
      return this.mensajeError.set('La contraseña debe tener al menos 6 caracteres.');
    this.guardando.set(true); this.mensajeError.set('');
    const fallo = (e: any, msg: string) => { this.mensajeError.set(e?.error?.error || msg); this.guardando.set(false); };

    if (id) {
      const d = { nombre_completo: f.nombre_completo, correo_electronico: f.correo_electronico, id_rol: f.id_rol, id_sucursal: f.id_sucursal };
      this.usuarioService.actualizarUsuario(id, d).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Usuario actualizado'); this.cargarDatos(); },
        error: (e) => fallo(e, 'No se pudo actualizar el usuario.')
      });
    } else {
      this.usuarioService.crearUsuario(f).subscribe({
        next:  () => { this.cerrarModal(); this.dialogo.avisar('Usuario creado'); this.cargarDatos(); },
        error: (e) => fallo(e, 'No se pudo crear el usuario.')
      });
    }
  }

  // ─── Confirmaciones ───
  pedirCambioEstado(usr: any) {
    const id = Number(usr.id_usuario), nombre = usr.nombre_completo;
    this.abrirConfirmacion(usr.estado_activo
      ? { titulo: `¿Desactivar a ${nombre}?`, mensaje: 'No podrá iniciar sesión. Sus ventas y registros se conservan.',
          boton: 'Desactivar', peligro: true,
          accion: () => this.usuarioService.desactivarUsuario(id), exito: () => `${nombre} desactivado` }
      : { titulo: `¿Reactivar a ${nombre}?`, mensaje: 'Podrá volver a iniciar sesión con su contraseña actual.',
          boton: 'Reactivar', peligro: false,
          accion: () => this.usuarioService.reactivarUsuario(id), exito: () => `${nombre} reactivado` });
  }

  pedirToggleCaja(usr: any) {
    const id = Number(usr.id_usuario), nombre = usr.nombre_completo;
    this.abrirConfirmacion(usr.caja_habilitada
      ? { titulo: `¿Cerrar la caja de ${nombre}?`, mensaje: 'No podrá registrar ventas hasta que la reabras.',
          boton: 'Cerrar caja', peligro: true,
          accion: () => this.cajaService.deshabilitarCaja(id), exito: () => `Caja de ${nombre} cerrada` }
      : { titulo: `¿Reabrir la caja de ${nombre}?`, mensaje: 'Si cerró caja hoy, se reabre su turno y puede vender de inmediato.',
          boton: 'Reabrir caja', peligro: false,
          accion: () => this.cajaService.habilitarCaja(id),
          exito: (res) => res?.usuario?.accion === 'TURNO_REABIERTO'
            ? `Caja de ${nombre} reabierta: ya puede vender`
            : `Caja de ${nombre} habilitada` });
  }

  private abrirConfirmacion(c: Confirmacion) {
    this.confirmacion.set(c);
    this.confirmando.set(false);
    this.errorConfirmacion.set('');
  }

  cerrarConfirmacion() { if (!this.confirmando()) this.confirmacion.set(null); }

  ejecutarConfirmacion() {
    const c = this.confirmacion();
    if (!c) return;
    this.confirmando.set(true);
    c.accion().subscribe({
      next: (res) => {
        this.confirmando.set(false);
        this.confirmacion.set(null);
        this.dialogo.avisar(c.exito(res));
        this.cargarDatos();
      },
      error: (e: any) => {
        this.confirmando.set(false);
        this.errorConfirmacion.set(e?.error?.error || 'No se pudo completar la acción.');
      }
    });
  }

  // ─── Modal contraseña ───
  abrirModalContrasena(usr: any) {
    this.usuarioContrasena.set(usr);
    this.cambioContrasena.set({ nueva: '', confirmar: '' });
    this.errorContrasena.set('');
    this.cargandoContrasena.set(false);
    this.mostrarModalContrasena.set(true);
  }
  cerrarModalContrasena() { this.mostrarModalContrasena.set(false); }

  confirmarCambioContrasena() {
    if (this.cambioContrasena().nueva.length < 6) return this.errorContrasena.set('Mínimo 6 caracteres.');
    if (this.cambioContrasena().nueva !== this.cambioContrasena().confirmar) return this.errorContrasena.set('Las contraseñas no coinciden.');
    this.cargandoContrasena.set(true);
    this.usuarioService.cambiarContrasena(this.usuarioContrasena().id_usuario, this.cambioContrasena().nueva).subscribe({
      next: () => {
        this.cerrarModalContrasena();
        this.cargandoContrasena.set(false);
        this.dialogo.avisar(`Contraseña de ${this.usuarioContrasena().nombre_completo} actualizada`);
      },
      error: (e: any) => {
        this.errorContrasena.set(e?.error?.error || 'No se pudo cambiar la contraseña.');
        this.cargandoContrasena.set(false);
      }
    });
  }

  // ─── Modal permisos ───
  abrirModalPermisos(usr: any) {
    this.usuarioPermisos.set(usr);
    this.permisosEdicion.set({});
    this.errorPermisos.set('');
    this.cargandoPermisos.set(true);
    this.modulosCargados.set(false);
    this.mostrarModalPermisos.set(true);

    this.permisoService.obtenerPermisosUsuario(Number(usr.id_usuario)).subscribe({
      next: (res: any) => {
        this.permisosEdicion.set(Object.fromEntries(this.modulosSistema.map(m => [m.key, res?.permisos?.[m.key] === true])));
        this.cargandoPermisos.set(false);
        this.modulosCargados.set(true);
      },
      error: (e: any) => {
        this.cargandoPermisos.set(false);
        this.errorPermisos.set(e?.error?.error || 'No se pudieron cargar los permisos.');
      }
    });
  }

  cerrarModalPermisos() { this.mostrarModalPermisos.set(false); this.usuarioPermisos.set(null); }

  guardarPermisos() {
    if (!this.usuarioPermisos()) return;
    const nombre = this.usuarioPermisos().nombre_completo;
    const permisos: Record<string, boolean> = {};
    this.modulosSistema.forEach(m => { permisos[m.key] = this.permisosEdicion()[m.key] === true; });

    this.cargandoPermisos.set(true);
    this.errorPermisos.set('');
    this.permisoService.guardarPermisosUsuario(Number(this.usuarioPermisos().id_usuario), permisos).subscribe({
      next: () => {
        this.cargandoPermisos.set(false);
        this.cerrarModalPermisos();
        this.dialogo.avisar(`Permisos de ${nombre} guardados`);
      },
      error: (e: any) => {
        this.cargandoPermisos.set(false);
        this.errorPermisos.set(e?.error?.detalle || e?.error?.error || 'No se pudieron guardar los permisos.');
      }
    });
  }
}
