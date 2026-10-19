import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, Pencil, X, MapPin, Phone, Clock, Copy } from 'lucide-angular';
import { SucursalService } from '../../../../core/services/sucursal.service';
import { ConfirmacionComponent } from '../../../shared/confirmacion/confirmacion.component';
import { DialogoService } from '../../../../core/services/dialogo.service';

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
  private dialogo         = inject(DialogoService);

  readonly icons = { nuevo: Plus, editar: Pencil, cerrar: X, direccion: MapPin,
                     telefono: Phone, horario: Clock, copiar: Copy };
  readonly DIAS = DIAS;

  readonly sucursales = signal<any[]>([]);
  readonly cargando   = signal(true);
  readonly guardando  = signal(false);

  readonly modalAbierto = signal(false);
  readonly editandoId   = signal<number | null>(null);
  // Formulario y horario: se reemplazan con set(); el template edita los campos del objeto actual
  readonly formulario   = signal({ nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' });
  readonly horario      = signal<DiaHorario[]>([]);
  readonly errorFormulario = signal('');

  readonly aDesactivar     = signal<any>(null);
  readonly cambiandoEstado = signal(false);
  readonly errorEstado     = signal('');

  ngOnInit() { this.cargar(); }

  cargar() {
    this.sucursalService.listarSucursales().subscribe({
      next: (s) => { this.sucursales.set(s); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar las sucursales.'); }
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
    this.abrir(null, { nombre_sucursal: '', direccion_fisica: '', telefono_contacto: '' }, []);
  }

  abrirEdicion(s: any) {
    this.abrir(s.id_sucursal, {
      nombre_sucursal:   s.nombre_sucursal || '',
      direccion_fisica:  s.direccion_fisica || '',
      telefono_contacto: s.telefono_contacto || ''
    }, s.horario || []);
  }

  private abrir(id: number | null, formulario: { nombre_sucursal: string; direccion_fisica: string; telefono_contacto: string },
                horario: any[]) {
    this.editandoId.set(id);
    this.formulario.set(formulario);
    this.horario.set(this.armarHorario(horario));
    this.errorFormulario.set('');
    this.modalAbierto.set(true);
  }

  cerrarModal() { this.modalAbierto.set(false); }

  /** Copia el horario del lunes a todos los días */
  copiarLunes() {
    this.horario.update(h => h.map(d => ({ ...h[0], dia_semana: d.dia_semana })));
  }

  guardar() {
    const horario = this.horario();
    if (!this.formulario().nombre_sucursal.trim()) return this.errorFormulario.set('El nombre es obligatorio.');
    const incompleto = horario.find(d => d.abierto && (!d.hora_apertura || !d.hora_cierre || d.hora_apertura === d.hora_cierre));
    if (incompleto)
      return this.errorFormulario.set(`Revisa el horario del ${DIAS[incompleto.dia_semana - 1].toLowerCase()}: apertura y cierre deben ser distintas.`);
    const datos = { ...this.formulario(), horario };
    const id = this.editandoId();
    this.guardando.set(true);
    const peticion = id
      ? this.sucursalService.actualizarSucursal(id, datos)
      : this.sucursalService.crearSucursal(datos);
    peticion.subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.modalAbierto.set(false);
        this.dialogo.avisar(r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.errorFormulario.set(e?.error?.error || 'No se pudo guardar la sucursal.');
      }
    });
  }

  // Activar es directo; desactivar pide confirmación
  pedirCambioEstado(s: any) {
    if (s.estado_activo) { this.aDesactivar.set(s); this.errorEstado.set(''); }
    else this.cambiarEstado(s);
  }

  cancelarCambioEstado() {
    if (!this.cambiandoEstado()) this.aDesactivar.set(null);
  }

  cambiarEstado(s: any) {
    this.cambiandoEstado.set(true);
    this.sucursalService.cambiarEstado(s.id_sucursal, !s.estado_activo).subscribe({
      next: (r) => {
        this.cambiandoEstado.set(false);
        this.aDesactivar.set(null);
        this.dialogo.avisar(r.mensaje);
        this.cargar();
      },
      error: (e) => {
        this.cambiandoEstado.set(false);
        const msg = e?.error?.error || 'No se pudo cambiar el estado.';
        if (this.aDesactivar()) this.errorEstado.set(msg);
        else this.dialogo.error(msg);
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
}
