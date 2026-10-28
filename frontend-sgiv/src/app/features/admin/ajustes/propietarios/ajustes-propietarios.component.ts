import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, Trash2, X } from 'lucide-angular';
import { AjustesService, Propietario } from '../../../../core/services/ajustes.service';
import { ConfirmacionComponent } from '../../../shared/confirmacion/confirmacion.component';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

const VACIO: Propietario = {
  nombre_completo: '', ci: '', cargo: '', telefono: '', correo: '', porcentaje_participacion: 0
};

// ─── Ajustes → Propietarios ───
@Component({
  selector: 'app-ajustes-propietarios',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, ConfirmacionComponent],
  templateUrl: './ajustes-propietarios.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css']
})
export class AjustesPropietariosComponent implements OnInit {
  private ajustes = inject(AjustesService);
  private dialogo = inject(DialogoService);

  readonly icons = { nuevo: Plus, editar: Pencil, eliminar: Trash2, cerrar: X };

  readonly propietarios = signal<Propietario[]>([]);
  readonly cargando     = signal(true);
  readonly guardando    = signal(false);

  readonly modalAbierto    = signal(false);
  // Formulario: se reemplaza con set(); el template edita los campos del objeto actual
  readonly formulario      = signal<Propietario>({ ...VACIO });
  readonly errorFormulario = signal('');

  readonly aEliminar     = signal<Propietario | null>(null);
  readonly eliminando    = signal(false);
  readonly errorEliminar = signal('');

  readonly totalParticipacion = computed(() => {
    const suma = this.propietarios().reduce((s, p) => s + Number(p.porcentaje_participacion || 0), 0);
    return Math.round(suma * 100) / 100;
  });

  /** Lo que puede tener el propietario del formulario sin pasar el 100 % */
  readonly disponible = computed(() => {
    const id = this.formulario().id_propietario;
    const otros = this.propietarios()
      .filter(p => p.id_propietario !== id)
      .reduce((s, p) => s + Number(p.porcentaje_participacion || 0), 0);
    return Math.max(0, Math.round((100 - otros) * 100) / 100);
  });

  ngOnInit() { this.cargar(); }

  cargar() {
    this.ajustes.listarPropietarios().subscribe({
      next: (p) => { this.propietarios.set(p); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar los propietarios.'); }
    });
  }

  abrirNuevo() {
    this.abrir({ ...VACIO, porcentaje_participacion: this.disponibleParaNuevo() });
  }

  abrirEdicion(p: Propietario) {
    this.abrir({ ...p, porcentaje_participacion: Number(p.porcentaje_participacion) });
  }

  private abrir(formulario: Propietario) {
    this.formulario.set(formulario);
    this.errorFormulario.set('');
    this.modalAbierto.set(true);
  }

  cerrarModal() { this.modalAbierto.set(false); }

  pedirEliminar(p: Propietario) {
    this.aEliminar.set(p);
    this.errorEliminar.set('');
  }

  cancelarEliminar() {
    if (!this.eliminando()) this.aEliminar.set(null);
  }

  guardar() {
    const f = this.formulario();
    if (!f.nombre_completo?.trim()) return this.errorFormulario.set('El nombre es obligatorio.');
    if (Number(f.porcentaje_participacion) > this.disponible())
      return this.errorFormulario.set(`La participación no puede pasar de ${this.disponible()} % (el total sería mayor a 100 %).`);
    this.guardando.set(true);
    this.ajustes.guardarPropietario(f).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.modalAbierto.set(false);
        this.dialogo.avisar(r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorFormulario.set(e?.error?.error || 'No se pudo guardar.');
      }
    });
  }

  eliminar(p: Propietario) {
    this.eliminando.set(true);
    this.ajustes.eliminarPropietario(p.id_propietario!).subscribe({
      next: () => {
        this.eliminando.set(false);
        this.aEliminar.set(null);
        this.dialogo.avisar('Propietario eliminado');
        this.cargar();
      },
      error: (e) => {
        this.eliminando.set(false);
        this.errorEliminar.set(e?.error?.error || 'No se pudo eliminar.');
      }
    });
  }

  private disponibleParaNuevo(): number {
    return Math.max(0, Math.round((100 - this.totalParticipacion()) * 100) / 100);
  }
}
