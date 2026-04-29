import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsuarioService } from '../../../core/services/usuario.service';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './usuarios.component.html',
  styleUrl: './usuarios.component.css'
})
export class UsuariosComponent implements OnInit {
  private usuarioService = inject(UsuarioService);
  private cdr = inject(ChangeDetectorRef);

  listaUsuarios: any[] = [];
  listaRoles: any[] = [];
  listaSucursales: any[] = [];
  cargando = true;
  filtroEstado: 'todos' | 'activos' | 'inactivos' = 'todos';

  // Modal crear/editar
  mostrarModal = false;
  editandoId: number | null = null;
  mensajeError = '';
  formulario: any = { nombre_completo: '', correo_electronico: '', contrasena: '', id_rol: '', id_sucursal: '' };

  // Modal cambio de contraseña
  mostrarModalContrasena = false;
  usuarioContrasena: any = null;
  cambioContrasena = { nueva: '', confirmar: '' };
  errorContrasena = '';
  cargandoContrasena = false;

  ngOnInit() { this.cargarDatos(); }

  cargarDatos() {
    this.cargando = true;
    this.usuarioService.obtenerDatosFormulario().subscribe({ next: (d) => { this.listaRoles = d.roles; this.listaSucursales = d.sucursales; } });
    this.usuarioService.listarUsuarios().subscribe({
      next: (u) => { this.listaUsuarios = u; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  get usuariosFiltrados() {
    if (this.filtroEstado === 'activos') return this.listaUsuarios.filter(u => u.estado_activo);
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
    this.formulario = { nombre_completo: usr.nombre_completo, correo_electronico: usr.correo_electronico, contrasena: '', id_rol: usr.id_rol, id_sucursal: usr.id_sucursal };
    this.mostrarModal = true;
  }

  cerrarModal() { this.mostrarModal = false; this.editandoId = null; this.mensajeError = ''; }

  guardarUsuario() {
    if (!this.formulario.nombre_completo || !this.formulario.correo_electronico || !this.formulario.id_rol || !this.formulario.id_sucursal) {
      this.mensajeError = 'Completa todos los campos obligatorios.'; return;
    }
    if (!this.editandoId && !this.formulario.contrasena) {
      this.mensajeError = 'La contraseña es obligatoria al crear un usuario.'; return;
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
        error: (e) => { this.mensajeError = e.error?.error || 'Error al crear usuario.'; this.cargando = false; }
      });
    }
  }

  // ─── Desactivar / Reactivar ───
  desactivarUsuario(id: number, nombre: string) {
    if (!confirm(`¿Desactivar a "${nombre}"?`)) return;
    this.cargando = true;
    this.usuarioService.desactivarUsuario(id).subscribe({
      next: () => this.cargarDatos(),
      error: () => { alert('Error al desactivar.'); this.cargando = false; }
    });
  }

  reactivarUsuario(id: number, nombre: string) {
    if (!confirm(`¿Reactivar a "${nombre}"?`)) return;
    this.cargando = true;
    this.usuarioService.reactivarUsuario(id).subscribe({
      next: () => this.cargarDatos(),
      error: () => { alert('Error al reactivar.'); this.cargando = false; }
    });
  }

  // ─── Modal cambio de contraseña ───
  abrirModalContrasena(usr: any) {
    this.usuarioContrasena = usr;
    this.cambioContrasena = { nueva: '', confirmar: '' };
    this.errorContrasena = '';
    this.mostrarModalContrasena = true;
  }

  cerrarModalContrasena() { this.mostrarModalContrasena = false; this.usuarioContrasena = null; }

  confirmarCambioContrasena() {
    if (!this.cambioContrasena.nueva || this.cambioContrasena.nueva.length < 6) {
      this.errorContrasena = 'La contraseña debe tener al menos 6 caracteres.'; return;
    }
    if (this.cambioContrasena.nueva !== this.cambioContrasena.confirmar) {
      this.errorContrasena = 'Las contraseñas no coinciden.'; return;
    }
    this.cargandoContrasena = true; this.errorContrasena = '';
    this.usuarioService.cambiarContrasena(this.usuarioContrasena.id_usuario, this.cambioContrasena.nueva).subscribe({
      next: () => { this.cerrarModalContrasena(); this.cargandoContrasena = false; alert('Contraseña actualizada correctamente.'); },
      error: () => { this.errorContrasena = 'Error al cambiar la contraseña.'; this.cargandoContrasena = false; }
    });
  }

  getBadge(rol: string): string {
    const m: any = { 'Administrador': 'bg-purple-100 text-purple-700', 'Cajero': 'bg-blue-100 text-blue-700', 'Inventario': 'bg-green-100 text-green-700' };
    return m[rol] || 'bg-gray-100 text-gray-700';
  }
}