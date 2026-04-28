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

  // --- Datos ---
  listaUsuarios: any[] = [];
  listaRoles: any[] = [];
  listaSucursales: any[] = [];
  cargando: boolean = true;

  // --- Control de Modal ---
  mostrarModal: boolean = false;
  editandoId: number | null = null;
  mensajeError: string = '';

  // --- Formulario ---
  formulario: any = {
    nombre_completo: '',
    correo_electronico: '',
    contrasena: '',
    id_rol: '',
    id_sucursal: ''
  };

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    this.cargando = true;

    // Cargamos usuarios y datos del formulario al mismo tiempo
    this.usuarioService.obtenerDatosFormulario().subscribe({
      next: (datos) => {
        this.listaRoles = datos.roles;
        this.listaSucursales = datos.sucursales;
      },
      error: (err) => console.error('Error cargando formulario:', err)
    });

    this.usuarioService.listarUsuarios().subscribe({
      next: (usuarios) => {
        this.listaUsuarios = usuarios;
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando usuarios:', err);
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  // --- Modal: Nuevo Usuario ---
  abrirModalNuevo() {
    this.editandoId = null;
    this.mensajeError = '';
    this.formulario = {
      nombre_completo: '',
      correo_electronico: '',
      contrasena: '',
      id_rol: '',
      id_sucursal: ''
    };
    this.mostrarModal = true;
  }

  // --- Modal: Editar Usuario ---
  abrirModalEditar(usuario: any) {
    this.editandoId = usuario.id_usuario;
    this.mensajeError = '';
    this.formulario = {
      nombre_completo: usuario.nombre_completo,
      correo_electronico: usuario.correo_electronico,
      contrasena: '',           // Se deja vacío al editar
      id_rol: usuario.id_rol,
      id_sucursal: usuario.id_sucursal
    };
    this.mostrarModal = true;
  }

  cerrarModal() {
    this.mostrarModal = false;
    this.editandoId = null;
    this.mensajeError = '';
  }

  // --- Guardar (Crear o Editar) ---
  guardarUsuario() {
    // Validación básica
    if (!this.formulario.nombre_completo || !this.formulario.correo_electronico ||
        !this.formulario.id_rol || !this.formulario.id_sucursal) {
      this.mensajeError = 'Por favor, completa todos los campos obligatorios.';
      return;
    }
    if (!this.editandoId && !this.formulario.contrasena) {
      this.mensajeError = 'La contraseña es obligatoria al crear un usuario.';
      return;
    }

    this.cargando = true;
    this.mensajeError = '';

    if (this.editandoId) {
      // Modo Edición: enviamos solo los campos sin contraseña
      const datosEditar = {
        nombre_completo: this.formulario.nombre_completo,
        correo_electronico: this.formulario.correo_electronico,
        id_rol: this.formulario.id_rol,
        id_sucursal: this.formulario.id_sucursal
      };

      this.usuarioService.actualizarUsuario(this.editandoId, datosEditar).subscribe({
        next: () => {
          this.cerrarModal();
          this.cargarDatos();
        },
        error: (err) => {
          this.mensajeError = 'Error al actualizar. Verifica los datos.';
          this.cargando = false;
        }
      });

    } else {
      // Modo Creación
      this.usuarioService.crearUsuario(this.formulario).subscribe({
        next: () => {
          this.cerrarModal();
          this.cargarDatos();
        },
        error: (err) => {
          this.mensajeError = err.error?.error || 'Error al crear el usuario.';
          this.cargando = false;
        }
      });
    }
  }

  // --- Desactivar Usuario ---
  desactivarUsuario(id: number, nombre: string) {
    const confirmacion = confirm(
      `¿Estás seguro de que deseas desactivar al usuario "${nombre}"?\n\nEl usuario no podrá iniciar sesión.`
    );
    if (!confirmacion) return;

    this.cargando = true;
    this.usuarioService.desactivarUsuario(id).subscribe({
      next: (res) => {
        console.log(res.mensaje);
        this.cargarDatos();
      },
      error: (err) => {
        console.error('Error al desactivar:', err);
        alert('No se pudo desactivar el usuario.');
        this.cargando = false;
      }
    });
  }

  // --- Helper para el badge del rol ---
  getBadgeRol(nombreRol: string): string {
    const mapa: any = {
      'Administrador': 'bg-purple-100 text-purple-700',
      'Cajero': 'bg-blue-100 text-blue-700',
      'Inventario': 'bg-green-100 text-green-700'
    };
    return mapa[nombreRol] || 'bg-gray-100 text-gray-700';
  }
}