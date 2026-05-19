import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsuarioService } from '../../../core/services/usuario.service';
import { PermisoService, MODULOS } from '../../../core/services/permiso.service';
import { CajaService } from '../../../core/services/caja.service'; // <-- Import agregado

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './usuarios.component.html',
  styleUrl: './usuarios.component.css'
})
export class UsuariosComponent implements OnInit {
  private usuarioService = inject(UsuarioService);
  private permisoService = inject(PermisoService);
  private cdr            = inject(ChangeDetectorRef);
  private cajaService    = inject(CajaService); // <-- Inject agregado

  listaUsuarios:  any[] = [];
  listaRoles:     any[] = [];
  listaSucursales: any[] = [];
  cargando      = true;
  filtroEstado: 'todos' | 'activos' | 'inactivos' = 'todos';

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
  modulosSistema         = MODULOS;

  ngOnInit() { this.cargarDatos(); }

  cargarDatos() {
    this.cargando = true;
    this.usuarioService.obtenerDatosFormulario().subscribe({
      next: (d) => { this.listaRoles = d.roles; this.listaSucursales = d.sucursales; }
    });
    this.usuarioService.listarUsuarios().subscribe({
      next: (u) => { this.listaUsuarios = u; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  get usuariosFiltrados() {
    if (this.filtroEstado === 'activos')   return this.listaUsuarios.filter(u => u.estado_activo);
    if (this.filtroEstado === 'inactivos') return this.listaUsuarios.filter(u => !u.estado_activo);
    return this.listaUsuarios;
  }

  // ─── Modal CRUD ───
  abrirModalNuevo() {
    this.editandoId = null; this.mensajeError = '';
    this.formulario = { nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' };
    this.mostrarModal = true;
  }

  abrirModalEditar(usr: any) {
    this.editandoId = usr.id_usuario; this.mensajeError = '';
    this.formulario = {
      nombre_completo: usr.nombre_completo, correo_electronico: usr.correo_electronico,
      contrasena: '', id_rol: usr.id_rol, id_sucursal: usr.id_sucursal
    };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.mensajeError = ''; }

  guardarUsuario() {
    if (!this.formulario.nombre_completo || !this.formulario.correo_electronico ||
        !this.formulario.id_rol || !this.formulario.id_sucursal) {
      this.mensajeError = 'Completa todos los campos.'; return;
    }
    if (!this.editandoId && !this.formulario.contrasena) {
      this.mensajeError = 'La contraseña es obligatoria.'; return;
    }
    this.cargando = true; this.mensajeError = '';
    if (this.editandoId) {
      const d = { nombre_completo: this.formulario.nombre_completo, correo_electronico: this.formulario.correo_electronico, id_rol: this.formulario.id_rol, id_sucursal: this.formulario.id_sucursal };
      this.usuarioService.actualizarUsuario(this.editandoId, d).subscribe({
        next: () => { this.cerrarModal(); this.cargarDatos(); },
        error: () => { this.mensajeError = 'Error al actualizar.'; this.cargando = false; }
      });
    } else {
      this.usuarioService.crearUsuario(this.formulario).subscribe({
        next: () => { this.cerrarModal(); this.cargarDatos(); },
        error: (e) => { this.mensajeError = e.error?.error || 'Error al crear.'; this.cargando = false; }
      });
    }
  }

  // ─── Activar/Desactivar ───
  desactivarUsuario(id: number, nombre: string) {
    if (!confirm(`¿Desactivar a "${nombre}"?`)) return;
    this.cargando = true;
    this.usuarioService.desactivarUsuario(id).subscribe({
      next: () => this.cargarDatos(),
      error: () => { alert('Error.'); this.cargando = false; }
    });
  }

  reactivarUsuario(id: number, nombre: string) {
    if (!confirm(`¿Reactivar a "${nombre}"?`)) return;
    this.cargando = true;
    this.usuarioService.reactivarUsuario(id).subscribe({
      next: () => this.cargarDatos(),
      error: () => { alert('Error.'); this.cargando = false; }
    });
  }

  // ─── Modal contraseña ───
  abrirModalContrasena(usr: any) {
    this.usuarioContrasena = usr;
    this.cambioContrasena  = { nueva: '', confirmar: '' };
    this.errorContrasena   = '';
    this.mostrarModalContrasena = true;
  }
  cerrarModalContrasena() { this.mostrarModalContrasena = false; }

  confirmarCambioContrasena() {
    if (this.cambioContrasena.nueva.length < 6) { this.errorContrasena = 'Mínimo 6 caracteres.'; return; }
    if (this.cambioContrasena.nueva !== this.cambioContrasena.confirmar) { this.errorContrasena = 'No coinciden.'; return; }
    this.cargandoContrasena = true;
    this.usuarioService.cambiarContrasena(this.usuarioContrasena.id_usuario, this.cambioContrasena.nueva).subscribe({
      next: () => { this.cerrarModalContrasena(); this.cargandoContrasena = false; alert('Contraseña actualizada.'); },
      error: () => { this.errorContrasena = 'Error al cambiar.'; this.cargandoContrasena = false; }
    });
  }

  // ─── Modal permisos  ───
abrirModalPermisos(usr: any) {
  this.usuarioPermisos  = usr;
  this.permisosEdicion  = {};
  this.cargandoPermisos = true;
  this.mostrarModalPermisos = true;

  this.permisoService.obtenerPermisosUsuario(Number(usr.id_usuario)).subscribe({
    next: (res: any) => {
      // Inicializar todos los módulos en false primero
      this.modulosSistema.forEach(m => {
        this.permisosEdicion[m.key] = false;
      });
      // Aplicar los permisos recibidos
      if (res?.permisos) {
        Object.keys(res.permisos).forEach(k => {
          this.permisosEdicion[k] = res.permisos[k];
        });
      }
      this.cargandoPermisos = false;
      this.cdr.detectChanges();
    },
    error: (e: any) => {
      console.error('Error cargando permisos:', e);
      this.cargandoPermisos = false;
      alert('Error al cargar permisos del usuario.');
      this.cerrarModalPermisos();
    }
  });
}

  cerrarModalPermisos() { this.mostrarModalPermisos = false; this.usuarioPermisos = null; }

guardarPermisos() {
  if (!this.usuarioPermisos) return;
  this.cargandoPermisos = true;

  this.permisoService.guardarPermisosUsuario(
    Number(this.usuarioPermisos.id_usuario),
    this.permisosEdicion
  ).subscribe({
    next: (res: any) => {
      this.cargandoPermisos = false;
      this.cerrarModalPermisos();
      this.cdr.detectChanges();
      // Confirmación visual
      this.mostrarToast(`Permisos de "${this.usuarioPermisos.nombre_completo}" guardados.`);
    },
    error: (e: any) => {
      console.error('Error guardando permisos:', e);
      this.cargandoPermisos = false;
      alert('Error al guardar permisos. Verifica la conexión.');
    }
  });
}

mensajeExito: string | null = null;

private mostrarToast(msg: string) {
  this.mensajeExito = msg;
  this.cdr.detectChanges();
  setTimeout(() => { this.mensajeExito = null; this.cdr.detectChanges(); }, 3500);
}

  getBadge(rol: string): string {
    const m: any = { 'Administrador': 'bg-purple-100 text-purple-700', 'Cajero': 'bg-blue-100 text-blue-700', 'Cocina': 'bg-orange-100 text-orange-700' };
    return m[rol] || 'bg-gray-100 text-gray-700';
  }

  // ─── Control de Caja desde Usuarios (Admin) ───
  // - Caja abierta → la cierra (cierra turno + flag).
  // - Caja cerrada hoy → la reabre (reabre turno + flag).
  // - Sin turno hoy → solo habilita el flag (el cajero aún deberá ingresar monto inicial).
  toggleCaja(usr: any) {
    const id     = Number(usr.id_usuario);
    const nombre = usr.nombre_completo;

    if (usr.caja_habilitada) {
      if (!confirm(`¿Cerrar caja de "${nombre}"?\n\nEl cajero no podrá registrar más ventas hasta que la reabras.`)) return;

      this.cajaService.deshabilitarCaja(id).subscribe({
        next: () => {
          this.mostrarToast(`🔒 Caja de "${nombre}" cerrada.`);
          this.cargarDatos();
        },
        error: (e: any) => {
          const msg = e?.error?.error || 'Error al cerrar la caja.';
          alert(`Error: ${msg}`);
          console.error('toggleCaja error:', e);
        }
      });
    } else {
      if (!confirm(`¿Reabrir / habilitar caja para "${nombre}"?\n\nSi tiene una caja cerrada hoy, se reabrirá el turno y podrá vender de inmediato.`)) return;

      this.cajaService.habilitarCaja(id).subscribe({
        next: (res: any) => {
          const accion = res?.usuario?.accion;
          if (accion === 'TURNO_REABIERTO')
            this.mostrarToast(`🔓 Caja de "${nombre}" REABIERTA — ya puede vender.`);
          else
            this.mostrarToast(`💰 Caja de "${nombre}" habilitada.`);
          this.cargarDatos();
        },
        error: (e: any) => {
          const msg = e?.error?.error || 'Error al habilitar la caja.';
          alert(`Error: ${msg}`);
          console.error('toggleCaja error:', e);
        }
      });
    }
  }

}