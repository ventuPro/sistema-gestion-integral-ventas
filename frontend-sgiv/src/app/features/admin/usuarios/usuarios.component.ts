import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
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
  private usuarioService = inject(UsuarioService);
  private dialogo        = inject(DialogoService);
  private permisoService = inject(PermisoService);
  private cdr            = inject(ChangeDetectorRef);
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

  private idActual = Number(JSON.parse(localStorage.getItem('usuario_sgiv') || 'null')?.id_usuario) || 0;

  listaUsuarios:   any[] = [];
  listaRoles:      any[] = [];
  listaSucursales: any[] = [];
  cargando      = true;
  guardando     = false;
  busqueda      = '';
  filtroEstado: 'todos' | 'activos' | 'inactivos' = 'activos';
  resumen       = { activos: 0, admins: 0, cajeros: 0, cajasAbiertas: 0 };

  // Modal CRUD
  mostrarModal  = false;
  editandoId: number | null = null;
  mensajeError  = '';
  formulario: any = { nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' };

  // Modal cambio contraseña
  mostrarModalContrasena = false;
  usuarioContrasena: any = null;
  cambioContrasena       = { nueva: '', confirmar: '' };
  errorContrasena        = '';
  cargandoContrasena     = false;

  // Modal permisos
  mostrarModalPermisos   = false;
  usuarioPermisos: any   = null;
  permisosEdicion: Record<string, boolean> = {};
  cargandoPermisos       = false;
  modulosCargados        = false;
  errorPermisos          = '';
  modulosSistema         = MODULOS;

  // Confirmaciones (desactivar, reactivar, caja)
  confirmacion: Confirmacion | null = null;
  confirmando       = false;
  errorConfirmacion = '';


  ngOnInit() { this.cargarDatos(); }

  cargarDatos() {
    this.cargando = true;
    this.usuarioService.obtenerDatosFormulario().subscribe({
      next: (d) => { this.listaRoles = d.roles; this.listaSucursales = d.sucursales; this.cdr.detectChanges(); }
    });
    this.usuarioService.listarUsuarios().subscribe({
      next: (u) => {
        this.listaUsuarios = u;
        this.cargando      = false;
        this.calcularResumen();
        this.cdr.detectChanges();
      },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  private calcularResumen() {
    const activos = this.listaUsuarios.filter(u => u.estado_activo);
    const cajeros = activos.filter(u => +u.id_rol === 2);
    this.resumen = {
      activos:       activos.length,
      admins:        activos.filter(u => +u.id_rol === 1).length,
      cajeros:       cajeros.length,
      cajasAbiertas: cajeros.filter(u => u.caja_habilitada).length
    };
  }

  get usuariosFiltrados() {
    const texto = this.busqueda.trim().toLowerCase();
    return this.listaUsuarios.filter(u =>
      (this.filtroEstado === 'todos' || (this.filtroEstado === 'activos') === !!u.estado_activo) &&
      (!texto || `${u.nombre_completo} ${u.correo_electronico}`.toLowerCase().includes(texto))
    );
  }

  esYo(usr: any): boolean { return Number(usr.id_usuario) === this.idActual; }

  // ─── Modal CRUD ───
  abrirModalNuevo() {
    this.editandoId = null; this.mensajeError = ''; this.guardando = false;
    this.formulario = { nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' };
    this.mostrarModal = true;
  }

  abrirModalEditar(usr: any) {
    this.editandoId = usr.id_usuario; this.mensajeError = ''; this.guardando = false;
    this.formulario = {
      nombre_completo: usr.nombre_completo, correo_electronico: usr.correo_electronico,
      contrasena: '', id_rol: Number(usr.id_rol), id_sucursal: Number(usr.id_sucursal)
    };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.mensajeError = ''; }

  guardarUsuario() {
    const f = this.formulario;
    if (!f.nombre_completo || !f.correo_electronico || !f.id_rol || !f.id_sucursal) {
      this.mensajeError = 'Completa todos los campos.'; return;
    }
    if (!this.editandoId && (f.contrasena || '').length < 6) {
      this.mensajeError = 'La contraseña debe tener al menos 6 caracteres.'; return;
    }
    this.guardando = true; this.mensajeError = '';
    const fallo = (e: any, msg: string) => { this.mensajeError = e?.error?.error || msg; this.guardando = false; this.cdr.detectChanges(); };

    if (this.editandoId) {
      const d = { nombre_completo: f.nombre_completo, correo_electronico: f.correo_electronico, id_rol: f.id_rol, id_sucursal: f.id_sucursal };
      this.usuarioService.actualizarUsuario(this.editandoId, d).subscribe({
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
    this.confirmacion      = c;
    this.confirmando       = false;
    this.errorConfirmacion = '';
  }

  cerrarConfirmacion() { if (!this.confirmando) this.confirmacion = null; }

  ejecutarConfirmacion() {
    const c = this.confirmacion;
    if (!c) return;
    this.confirmando = true;
    c.accion().subscribe({
      next: (res) => {
        this.confirmando  = false;
        this.confirmacion = null;
        this.dialogo.avisar(c.exito(res));
        this.cargarDatos();
      },
      error: (e: any) => {
        this.confirmando       = false;
        this.errorConfirmacion = e?.error?.error || 'No se pudo completar la acción.';
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Modal contraseña ───
  abrirModalContrasena(usr: any) {
    this.usuarioContrasena  = usr;
    this.cambioContrasena   = { nueva: '', confirmar: '' };
    this.errorContrasena    = '';
    this.cargandoContrasena = false;
    this.mostrarModalContrasena = true;
  }
  cerrarModalContrasena() { this.mostrarModalContrasena = false; }

  confirmarCambioContrasena() {
    if (this.cambioContrasena.nueva.length < 6) { this.errorContrasena = 'Mínimo 6 caracteres.'; return; }
    if (this.cambioContrasena.nueva !== this.cambioContrasena.confirmar) { this.errorContrasena = 'Las contraseñas no coinciden.'; return; }
    this.cargandoContrasena = true;
    this.usuarioService.cambiarContrasena(this.usuarioContrasena.id_usuario, this.cambioContrasena.nueva).subscribe({
      next: () => {
        this.cerrarModalContrasena();
        this.cargandoContrasena = false;
        this.dialogo.avisar(`Contraseña de ${this.usuarioContrasena.nombre_completo} actualizada`);
      },
      error: (e: any) => {
        this.errorContrasena    = e?.error?.error || 'No se pudo cambiar la contraseña.';
        this.cargandoContrasena = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ─── Modal permisos ───
  abrirModalPermisos(usr: any) {
    this.usuarioPermisos  = usr;
    this.permisosEdicion  = {};
    this.errorPermisos    = '';
    this.cargandoPermisos = true;
    this.modulosCargados  = false;
    this.mostrarModalPermisos = true;

    this.permisoService.obtenerPermisosUsuario(Number(usr.id_usuario)).subscribe({
      next: (res: any) => {
        this.modulosSistema.forEach(m => { this.permisosEdicion[m.key] = res?.permisos?.[m.key] === true; });
        this.cargandoPermisos = false;
        this.modulosCargados  = true;
        this.cdr.detectChanges();
      },
      error: (e: any) => {
        this.cargandoPermisos = false;
        this.errorPermisos    = e?.error?.error || 'No se pudieron cargar los permisos.';
        this.cdr.detectChanges();
      }
    });
  }

  cerrarModalPermisos() { this.mostrarModalPermisos = false; this.usuarioPermisos = null; }

  guardarPermisos() {
    if (!this.usuarioPermisos) return;
    const nombre = this.usuarioPermisos.nombre_completo;
    const permisos: Record<string, boolean> = {};
    this.modulosSistema.forEach(m => { permisos[m.key] = this.permisosEdicion[m.key] === true; });

    this.cargandoPermisos = true;
    this.errorPermisos    = '';
    this.permisoService.guardarPermisosUsuario(Number(this.usuarioPermisos.id_usuario), permisos).subscribe({
      next: () => {
        this.cargandoPermisos = false;
        this.cerrarModalPermisos();
        this.dialogo.avisar(`Permisos de ${nombre} guardados`);
      },
      error: (e: any) => {
        this.cargandoPermisos = false;
        this.errorPermisos    = e?.error?.detalle || e?.error?.error || 'No se pudieron guardar los permisos.';
        this.cdr.detectChanges();
      }
    });
  }
}
