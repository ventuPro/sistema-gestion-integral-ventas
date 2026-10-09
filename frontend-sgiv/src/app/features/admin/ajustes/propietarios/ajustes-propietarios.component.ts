import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, Trash2, X, Users } from 'lucide-angular';
import { AjustesService, Propietario } from '../../../../core/services/ajustes.service';

const VACIO: Propietario = {
  nombre_completo: '', ci: '', cargo: '', telefono: '', correo: '', porcentaje_participacion: 0
};

// ─── Ajustes → Propietarios ───
@Component({
  selector: 'app-ajustes-propietarios',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './ajustes-propietarios.component.html'
})
export class AjustesPropietariosComponent implements OnInit {
  private ajustes = inject(AjustesService);
  private cdr     = inject(ChangeDetectorRef);

  readonly icons = { nuevo: Plus, editar: Pencil, eliminar: Trash2, cerrar: X, vacio: Users };

  propietarios: Propietario[] = [];
  cargando = true;
  guardando = false;
  mensaje: { tipo: 'ok' | 'error'; texto: string } | null = null;

  modalAbierto = false;
  formulario: Propietario = { ...VACIO };
  errorFormulario = '';

  ngOnInit() { this.cargar(); }

  cargar() {
    this.ajustes.listarPropietarios().subscribe({
      next: (p) => { this.propietarios = p; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.avisar('error', 'No se pudieron cargar los propietarios.'); }
    });
  }

  get totalParticipacion(): number {
    const suma = this.propietarios.reduce((s, p) => s + Number(p.porcentaje_participacion || 0), 0);
    return Math.round(suma * 100) / 100;
  }

  /** Lo que puede tener el propietario del formulario sin pasar el 100 % */
  get disponible(): number {
    const otros = this.propietarios
      .filter(p => p.id_propietario !== this.formulario.id_propietario)
      .reduce((s, p) => s + Number(p.porcentaje_participacion || 0), 0);
    return Math.max(0, Math.round((100 - otros) * 100) / 100);
  }

  abrirNuevo() {
    this.formulario = { ...VACIO, porcentaje_participacion: this.disponibleParaNuevo() };
    this.errorFormulario = '';
    this.modalAbierto = true;
  }

  abrirEdicion(p: Propietario) {
    this.formulario = { ...p, porcentaje_participacion: Number(p.porcentaje_participacion) };
    this.errorFormulario = '';
    this.modalAbierto = true;
  }

  cerrarModal() { this.modalAbierto = false; }

  guardar() {
    if (!this.formulario.nombre_completo?.trim()) { this.errorFormulario = 'El nombre es obligatorio.'; return; }
    if (Number(this.formulario.porcentaje_participacion) > this.disponible) {
      this.errorFormulario = `La participación no puede pasar de ${this.disponible} % (el total sería mayor a 100 %).`;
      return;
    }
    this.guardando = true;
    this.ajustes.guardarPropietario(this.formulario).subscribe({
      next: (r) => {
        this.guardando = false;
        this.modalAbierto = false;
        this.avisar('ok', `✓ ${r.mensaje}`);
        this.cargar();
      },
      error: (e) => {
        this.guardando = false;
        this.errorFormulario = e?.error?.error || 'No se pudo guardar.';
        this.cdr.detectChanges();
      }
    });
  }

  eliminar(p: Propietario) {
    if (!confirm(`¿Eliminar a ${p.nombre_completo} de la lista de propietarios?`)) return;
    this.ajustes.eliminarPropietario(p.id_propietario!).subscribe({
      next: () => { this.avisar('ok', '✓ Propietario eliminado'); this.cargar(); },
      error: (e) => this.avisar('error', e?.error?.error || 'No se pudo eliminar.')
    });
  }

  private disponibleParaNuevo(): number {
    return Math.max(0, Math.round((100 - this.totalParticipacion) * 100) / 100);
  }

  private avisar(tipo: 'ok' | 'error', texto: string) {
    this.mensaje = { tipo, texto };
    this.cdr.detectChanges();
    setTimeout(() => { this.mensaje = null; this.cdr.detectChanges(); }, 4000);
  }
}
