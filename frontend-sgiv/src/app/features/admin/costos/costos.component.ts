import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, Observable } from 'rxjs';
import { LucideAngularModule, Plus, Search, X, Pencil, Trash2, History } from 'lucide-angular';
import { CostoService, Insumo, Receta, TipoUnidad, Unidad } from '../../../core/services/costo.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { DialogoService } from '../../../core/services/dialogo.service';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { cifra, fechaHora } from '../../../core/utils/informe';

interface FormInsumo { id_insumo: number | null; nombre: string; cantidad_compra: number | null; id_unidad_compra: number | null; precio_compra: number | null }
interface Fila { id_insumo: number | null; cantidad: number | null; id_unidad: number | null }
interface FormReceta { id_receta: number | null; nombre: string; rendimiento: number | null; filas: Fila[] }

const BASE: Record<TipoUnidad, string> = { PESO: 'g', VOLUMEN: 'ml', CANTIDAD: 'u' };

// ─── Costos de producción: insumos con su precio y recetas con su inversión (solo administrador) ───
@Component({
  selector: 'app-costos',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, FondoModalDirective],
  templateUrl: './costos.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './costos.component.css']
})
export class CostosComponent implements OnInit {
  private costos  = inject(CostoService);
  private dialogo = inject(DialogoService);
  readonly moneda = inject(AjustesService).moneda;
  readonly cifra  = cifra;
  readonly fechaHora = fechaHora;
  readonly icons  = { nuevo: Plus, buscar: Search, cerrar: X, editar: Pencil, eliminar: Trash2, historial: History };

  readonly vista     = signal<'insumos' | 'recetas'>('insumos');
  readonly cargando  = signal(true);
  readonly busqueda  = signal('');
  readonly unidades  = signal<Unidad[]>([]);
  readonly insumos   = signal<Insumo[]>([]);
  readonly recetas   = signal<Receta[]>([]);

  private readonly filtrar = <T extends { nombre: string }>(lista: T[]) => {
    const q = this.busqueda().trim().toLowerCase();
    return q ? lista.filter(x => x.nombre.toLowerCase().includes(q)) : lista;
  };
  readonly insumosFiltrados = computed(() => this.filtrar(this.insumos()));
  readonly recetasFiltradas = computed(() => this.filtrar(this.recetas()));

  private readonly unidadPorId = computed(() => new Map(this.unidades().map(u => [u.id_unidad, u])));
  private readonly insumoPorId = computed(() => new Map(this.insumos().map(i => [i.id_insumo, i])));

  ngOnInit() {
    forkJoin({ u: this.costos.unidades(), i: this.costos.insumos(), r: this.costos.recetas() }).subscribe({
      next: ({ u, i, r }) => { this.unidades.set(u); this.insumos.set(i); this.recetas.set(r); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudo cargar Costos.'); }
    });
  }

  private recargar() {
    forkJoin({ i: this.costos.insumos(), r: this.costos.recetas() })
      .subscribe(({ i, r }) => { this.insumos.set(i); this.recetas.set(r); });
  }

  cambiarVista(v: 'insumos' | 'recetas') { this.vista.set(v); this.busqueda.set(''); }

  // ─── Formato ───
  base(tipo: TipoUnidad) { return BASE[tipo]; }
  /** Costos pequeños (por gramo) con más decimales */
  precisa(v: number) { return Math.abs(v) >= 1 ? cifra(v) : cifra(v, 6).replace(/0{1,4}$/, ''); }
  cantidad(v: number)  { return Number(v).toLocaleString('es-BO', { maximumFractionDigits: 4 }); }
  unidadesDeTipo(tipo: TipoUnidad | undefined) { return tipo ? this.unidades().filter(u => u.tipo === tipo) : this.unidades(); }

  // ─── Insumos ───
  readonly formInsumo  = signal<FormInsumo | null>(null);
  readonly errorInsumo = signal('');
  readonly guardando   = signal(false);

  /** Costo por g / ml / unidad del formulario, antes de guardar (los campos editan el objeto: se lee en cada pintado) */
  costoForm() {
    const f = this.formInsumo(), u = f?.id_unidad_compra ? this.unidadPorId().get(Number(f.id_unidad_compra)) : null;
    if (!f || !u || !(Number(f.cantidad_compra) > 0) || f.precio_compra == null) return null;
    return { valor: Number(f.precio_compra) / (Number(f.cantidad_compra) * u.factor_base), base: BASE[u.tipo] };
  }

  nuevoInsumo() {
    this.errorInsumo.set('');
    this.formInsumo.set({ id_insumo: null, nombre: '', cantidad_compra: null, id_unidad_compra: null, precio_compra: null });
  }

  editarInsumo(i: Insumo) {
    this.errorInsumo.set('');
    this.formInsumo.set({ id_insumo: i.id_insumo, nombre: i.nombre, cantidad_compra: i.cantidad_compra,
                          id_unidad_compra: i.id_unidad_compra, precio_compra: i.precio_compra });
  }

  cerrarInsumo() { if (!this.guardando()) this.formInsumo.set(null); }

  guardarInsumo() {
    const f = this.formInsumo();
    if (!f || this.guardando()) return;
    if (!f.nombre.trim()) return this.errorInsumo.set('Escribe el nombre.');
    if (!(Number(f.cantidad_compra) > 0) || !f.id_unidad_compra) return this.errorInsumo.set('Indica cuánto trae la compra.');
    if (f.precio_compra == null || Number(f.precio_compra) < 0) return this.errorInsumo.set('Indica el precio.');
    const datos = { nombre: f.nombre, cantidad_compra: Number(f.cantidad_compra), id_unidad_compra: Number(f.id_unidad_compra),
                    precio_compra: Number(f.precio_compra) };
    this.guardando.set(true);
    const peticion: Observable<{ recetas_actualizadas?: number }> =
      f.id_insumo ? this.costos.actualizarInsumo(f.id_insumo, datos) : this.costos.crearInsumo(datos);
    peticion.subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.formInsumo.set(null);
        this.avisarRecetas(r?.recetas_actualizadas, f.id_insumo ? 'Insumo guardado' : 'Insumo creado');
        this.recargar();
      },
      error: (e: any) => { this.guardando.set(false); this.errorInsumo.set(e?.error?.error || 'No se pudo guardar.'); }
    });
  }

  /** Precio editado en la lista: se guarda al salir del campo o con Enter */
  cambiarPrecio(i: Insumo, evento: Event) {
    const campo = evento.target as HTMLInputElement;
    const precio = Math.round(Number(campo.value) * 100) / 100;
    if (campo.value === '' || !Number.isFinite(precio) || precio < 0) { campo.value = String(i.precio_compra); return; }
    if (precio === i.precio_compra) return;
    this.costos.actualizarInsumo(i.id_insumo, { precio_compra: precio }).subscribe({
      next: (r) => { this.avisarRecetas(r.recetas_actualizadas, 'Precio guardado'); this.recargar(); },
      error: (e) => { campo.value = String(i.precio_compra); this.dialogo.error(e?.error?.error || 'No se pudo guardar el precio.'); }
    });
  }

  private avisarRecetas(n: number | undefined, texto: string) {
    this.dialogo.avisar(n ? `${texto} · ${n} receta(s) actualizada(s)` : texto);
  }

  async eliminarInsumo(i: Insumo) {
    if (!(await this.dialogo.confirmar({ titulo: `¿Eliminar ${i.nombre}?`, textoConfirmar: 'Eliminar', peligro: true }))) return;
    this.costos.eliminarInsumo(i.id_insumo).subscribe({
      next: () => { this.dialogo.avisar('Insumo eliminado'); this.recargar(); },
      error: (e) => this.dialogo.error(e?.error?.error || 'No se pudo eliminar.')
    });
  }

  // ─── Recetas ───
  readonly formReceta  = signal<FormReceta | null>(null);
  readonly errorReceta = signal('');

  /** Costo de cada fila y total con los precios actuales (el servidor guarda el definitivo) */
  readonly calculo = computed(() => {
    const f = this.formReceta();
    if (!f) return null;
    const costos = f.filas.map(x => {
      const ins = x.id_insumo ? this.insumoPorId().get(Number(x.id_insumo)) : null;
      const u   = x.id_unidad ? this.unidadPorId().get(Number(x.id_unidad)) : null;
      return ins && u && Number(x.cantidad) > 0 && u.tipo === ins.tipo ? Number(x.cantidad) * u.factor_base * ins.costo_base : null;
    });
    const total = costos.reduce<number>((s, c) => s + (c ?? 0), 0);
    return { costos, total, porUnidad: Number(f.rendimiento) > 0 ? total / Number(f.rendimiento) : null };
  });

  tipoDeFila(x: Fila): TipoUnidad | undefined {
    return x.id_insumo ? this.insumoPorId().get(Number(x.id_insumo))?.tipo : undefined;
  }

  nuevaReceta() {
    this.errorReceta.set('');
    this.formReceta.set({ id_receta: null, nombre: '', rendimiento: null, filas: [{ id_insumo: null, cantidad: null, id_unidad: null }] });
  }

  editarReceta(r: Receta) {
    this.costos.receta(r.id_receta).subscribe({
      next: (d) => {
        this.errorReceta.set('');
        this.formReceta.set({ id_receta: d.id_receta, nombre: d.nombre, rendimiento: d.rendimiento,
          filas: d.ingredientes.map(x => ({ id_insumo: x.id_insumo, cantidad: x.cantidad, id_unidad: x.id_unidad })) });
      },
      error: () => this.dialogo.error('No se pudo abrir la receta.')
    });
  }

  cerrarReceta() { if (!this.guardando()) this.formReceta.set(null); }

  agregarFila() {
    this.formReceta.update(f => f && { ...f, filas: [...f.filas, { id_insumo: null, cantidad: null, id_unidad: null }] });
  }

  quitarFila(i: number) {
    this.formReceta.update(f => f && { ...f, filas: f.filas.filter((_, k) => k !== i) });
  }

  /** Al elegir el insumo, la unidad pasa a la base de su tipo (g, ml o u) */
  elegirInsumo(i: number, id: any) {
    const tipo = this.insumoPorId().get(Number(id))?.tipo;
    const unidad = this.unidades().find(u => u.tipo === tipo && u.factor_base === 1)?.id_unidad ?? null;
    this.formReceta.update(f => f && { ...f, filas: f.filas.map((x, k) => k === i ? { ...x, id_insumo: Number(id) || null, id_unidad: unidad } : x) });
  }

  /** Cantidad o unidad editada (el objeto se reemplaza para que el cálculo se actualice) */
  cambiarFila(i: number, campo: 'cantidad' | 'id_unidad', valor: any) {
    this.formReceta.update(f => f && { ...f, filas: f.filas.map((x, k) => k === i ? { ...x, [campo]: valor === '' || valor == null ? null : Number(valor) } : x) });
  }

  cambiarDato(campo: 'nombre' | 'rendimiento', valor: any) {
    this.formReceta.update(f => f && { ...f, [campo]: campo === 'nombre' ? valor : (valor === '' || valor == null ? null : Number(valor)) });
  }

  guardarReceta() {
    const f = this.formReceta();
    if (!f || this.guardando()) return;
    const filas = f.filas.filter(x => x.id_insumo);
    if (!f.nombre.trim()) return this.errorReceta.set('Escribe el nombre.');
    if (!(Number(f.rendimiento) > 0)) return this.errorReceta.set('Indica cuántas unidades rinde.');
    if (!filas.length) return this.errorReceta.set('Agrega al menos un insumo.');
    if (filas.some(x => !(Number(x.cantidad) > 0) || !x.id_unidad)) return this.errorReceta.set('Completa la cantidad de cada insumo.');
    this.guardando.set(true);
    this.costos.guardarReceta(f.id_receta, {
      nombre: f.nombre, rendimiento: Number(f.rendimiento),
      ingredientes: filas.map(x => ({ id_insumo: Number(x.id_insumo), cantidad: Number(x.cantidad), id_unidad: Number(x.id_unidad) }))
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.formReceta.set(null);
        this.dialogo.avisar(f.id_receta ? 'Receta guardada' : 'Receta creada');
        this.recargar();
      },
      error: (e: any) => { this.guardando.set(false); this.errorReceta.set(e?.error?.error || 'No se pudo guardar.'); }
    });
  }

  async eliminarReceta(r: Receta) {
    if (!(await this.dialogo.confirmar({ titulo: `¿Eliminar la receta ${r.nombre}?`, textoConfirmar: 'Eliminar', peligro: true }))) return;
    this.costos.eliminarReceta(r.id_receta).subscribe({
      next: () => { this.dialogo.avisar('Receta eliminada'); this.recargar(); },
      error: (e) => this.dialogo.error(e?.error?.error || 'No se pudo eliminar.')
    });
  }

  // ─── Historial ───
  readonly historial = signal<{ titulo: string; tipo: 'insumo' | 'receta'; filas: any[] } | null>(null);

  verHistorialInsumo(i: Insumo) {
    this.costos.historialInsumo(i.id_insumo).subscribe(f => this.historial.set({ titulo: i.nombre, tipo: 'insumo', filas: f }));
  }

  verHistorialReceta(r: Receta) {
    this.costos.historialReceta(r.id_receta).subscribe(f => this.historial.set({ titulo: r.nombre, tipo: 'receta', filas: f }));
  }
}
