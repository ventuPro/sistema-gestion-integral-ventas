import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, X, MapPin, Phone, Clock, Copy } from 'lucide-angular';
import { SucursalService } from '../../../../core/services/sucursal.service';
import { ConfirmacionComponent } from '../../../shared/confirmacion/confirmacion.component';

interface DiaHorario { dia_semana: number; abierto: boolean; hora_apertura: string; hora_cierre: string }

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// ─── Ajustes → Sucursales ───
@Component({
  selector: 'app-ajustes-sucursales',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ConfirmacionComponent],
  templateUrl: './ajustes-sucursales.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css', './ajustes-sucursales.component.css']
})
export class AjustesSucursalesComponent implements OnInit {
  private sucursalService = inject(SucursalService);
  private cdr             = inject(ChangeDetectorRef);

  readonly icons = { nuevo: Plus, editar: Pencil, cerrar: X, direccion: MapPin,
                     telefono: Phone, horario: Clock, copiar: Copy };
  readonly DIAS = DIAS;

  sucursales: any[] = [];
  cargando = true;
  guardando = false;
  mensaje: { tipo: 'ok' | 'error'; texto: string } | null = null;

  modalAbierto = false;
  editandoId: number | null = null;
  formulario = { nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' };
  horario: DiaHorario[] = [];
  errorFormulario = '';

  aDesactivar: any = null;
  cambiandoEstado = false;
  errorEstado     = '';

  ngOnInit() { this.cargar(); }

  cargar() {
    this.sucursalService.listarSucursales().subscribe({
      next: (s) => { this.sucursales = s; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.avisar('error', 'No se pudieron cargar las sucursales.'); }
    });
  }

  /** Resumen del horario: agrupa días seguidos con el mismo horario ("Lun–Vie 08:00–20:00") */
  resumenHorario(s: any): string[] {
    const h: any[] = s.horario || [];
    if (!h.length) return ['Horario no definido'];
    const texto = (d: any) => d ? (d.abierto ? `${d.hora_apertura}–${d.hora_cierre}` : 'Cerrado') : 'Sin definir';
    const lineas: string[] = [];
    let inicio = 1;
    for (let dia = 1; dia <= 7; dia++) {
      const actual = texto(h.find(x => x.dia_semana === dia));
      const siguiente = dia < 7 ? texto(h.find(x => x.dia_semana === dia + 1)) : null;
      if (actual !== siguiente) {
        const dias = inicio === dia ? DIAS_CORTOS[dia - 1] : `${DIAS_CORTOS[inicio - 1]}–${DIAS_CORTOS[dia - 1]}`;
        lineas.push(`${dias}: ${actual}`);
        inicio = dia + 1;
      }
    }
    return lineas;
  }

  abrirNueva() {
    this.editandoId = null;
    this.formulario = { nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' };
    this.horario = this.armarHorario([]);
    this.errorFormulario = '';
    this.modalAbierto = true;
  }

  abrirEdicion(s: any) {
    this.editandoId = s.id_sucursal;
    this.formulario = {
      nombre_sucursal:   s.nombre_sucursal || '',
      direccion_fisica:  s.direccion_fisica || '',
      telefono_contacto: s.telefono_contacto || ''
    };
    this.horario = this.armarHorario(s.horario || []);
    this.errorFormulario = '';
    this.modalAbierto = true;
  }

  cerrarModal() { this.modalAbierto = false; }

  /** Copia el horario del lunes a todos los días */
  copiarLunes() {
    const lunes = this.horario[0];
    this.horario = this.horario.map(d => ({ ...lunes, dia_semana: d.dia_semana }));
  }

  guardar() {
    if (!this.formulario.nombre_sucursal.trim()) { this.errorFormulario = 'El nombre es obligatorio.'; return; }
    const incompleto = this.horario.find(d => d.abierto && (!d.hora_apertura || !d.hora_cierre || d.hora_apertura === d.hora_cierre));
    if (incompleto) {
      this.errorFormulario = `Revisa el horario del ${DIAS[incompleto.dia_semana - 1].toLowerCase()}: apertura y cierre deben ser distintas.`;
      return;
    }
    const datos = { ...this.formulario, horario: this.horario };
    this.guardando = true;
    const peticion = this.editandoId
      ? this.sucursalService.actualizarSucursal(this.editandoId, datos)
      : this.sucursalService.crearSucursal(datos);
    peticion.subscribe({
      next: (r) => {
        this.guardando = false;
        this.modalAbierto = false;
        this.avisar('ok', r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.guardando = false;
        this.errorFormulario = e?.error?.error || 'No se pudo guardar la sucursal.';
        this.cdr.detectChanges();
      }
    });
  }

  // Activar es directo; desactivar pide confirmación
  pedirCambioEstado(s: any) {
    if (s.estado_activo) { this.aDesactivar = s; this.errorEstado = ''; }
    else this.cambiarEstado(s);
  }

  cambiarEstado(s: any) {
    this.cambiandoEstado = true;
    this.sucursalService.cambiarEstado(s.id_sucursal, !s.estado_activo).subscribe({
      next: (r) => {
        this.cambiandoEstado = false;
        this.aDesactivar     = null;
        this.avisar('ok', r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.cambiandoEstado = false;
        const msg = e?.error?.error || 'No se pudo cambiar el estado.';
        if (this.aDesactivar) this.errorEstado = msg;
        else this.avisar('error', msg);
        this.cdr.detectChanges();
      }
    });
  }

  private armarHorario(guardado: any[]): DiaHorario[] {
    return DIAS.map((_, i) => {
      const h = guardado.find(x => x.dia_semana === i + 1);
      return h
        ? { dia_semana: i + 1, abierto: h.abierto, hora_apertura: h.hora_apertura || '08:00', hora_cierre: h.hora_cierre || '20:00' }
        : { dia_semana: i + 1, abierto: true, hora_apertura: '08:00', hora_cierre: '20:00' };
    });
  }

  private avisar(tipo: 'ok' | 'error', texto: string) {
    this.mensaje = { tipo, texto };
    this.cdr.detectChanges();
    setTimeout(() => { this.mensaje = null; this.cdr.detectChanges(); }, 5000);
  }
}
