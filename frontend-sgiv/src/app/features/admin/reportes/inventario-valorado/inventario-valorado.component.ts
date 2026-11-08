import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LucideAngularModule, ChevronRight, ChevronDown, FileSpreadsheet, FileText } from 'lucide-angular';
import { ReporteService } from '../../../../core/services/reporte.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { cifra, entero, fechaDia, fechaHora } from '../../../../core/utils/informe';
import { nombreArchivo, nuevoPdf } from '../pdf-reporte';

type Estado = 'todos' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO';
type Tipo = 'todos' | 'ELABORADO' | 'COMPRADO';

interface Lote { id_lote: number; fecha_ingreso: string; fecha_vencimiento: string | null; cantidad: number; costo_unitario: number | null; estado: string }
interface Fila {
  clave: string; id_producto: number; nombre_producto: string; tipo_producto: string; nombre_sucursal: string; precio: number;
  cantidad: number; sin_costo: number; valor_costo: number; valor_venta: number; ganancia: number; costo_promedio: number | null;
  por_vencer: number; vencidos: number; lotes: Lote[];
}
interface Grupo { nombre: string; productos: Fila[]; totales: Totales }
interface Totales { cantidad: number; sin_costo: number; valor_costo: number; valor_venta: number; ganancia: number }

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Reportes → «Inventario valorado»: cuánto vale lo que hay (al costo PEPS y a precio de venta) ───
@Component({
  selector: 'app-inventario-valorado',
  standalone: true,
  imports: [LucideAngularModule, DatePipe],
  templateUrl: './inventario-valorado.component.html',
  styleUrls: ['../../../shared/informe/informe.css']
})
export class InventarioValoradoComponent {
  private reportes = inject(ReporteService);
  private ajustes  = inject(AjustesService);
  readonly moneda  = this.ajustes.moneda;

  readonly idSucursal     = input.required<number>();   // 0 = todas
  readonly nombreSucursal = input('');

  readonly icons = { abrir: ChevronRight, cerrar: ChevronDown, excel: FileSpreadsheet, pdf: FileText };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly hoy = hoy();

  readonly fecha     = signal(hoy());
  readonly estado    = signal<Estado>('todos');
  readonly tipo      = signal<Tipo>('todos');
  readonly categoria = signal('');
  readonly abiertos  = signal<Set<string>>(new Set());
  readonly carga     = signal<'cargando' | 'listo' | 'error'>('cargando');
  private  datos     = signal<any>(null);

  readonly estados: { id: Estado; nombre: string }[] = [
    { id: 'todos', nombre: 'Todos' }, { id: 'VIGENTE', nombre: 'Vigentes' },
    { id: 'POR_VENCER', nombre: 'Por vencer' }, { id: 'VENCIDO', nombre: 'Vencidos' }
  ];
  readonly tipos: { id: Tipo; nombre: string }[] = [
    { id: 'todos', nombre: 'Todo' }, { id: 'ELABORADO', nombre: 'Elaborado' }, { id: 'COMPRADO', nombre: 'Comprado' }
  ];

  readonly todas = computed(() => this.idSucursal() === 0);
  readonly categorias = computed<string[]>(() => (this.datos()?.categorias || []).map((c: any) => c.nombre));

  /** Filtros sobre los lotes: cada producto se vuelve a sumar con los lotes que quedan */
  readonly grupos = computed<Grupo[]>(() => {
    const est = this.estado(), tipo = this.tipo(), cat = this.categoria();
    return (this.datos()?.categorias || [])
      .filter((c: any) => !cat || c.nombre === cat)
      .map((c: any) => {
        const productos: Fila[] = c.productos
          .filter((p: any) => tipo === 'todos' || p.tipo_producto === tipo)
          .map((p: any) => this.sumar(p, p.lotes.filter((l: Lote) => est === 'todos' || l.estado === est)))
          .filter((p: Fila) => p.cantidad > 0);
        return { nombre: c.nombre, productos, totales: this.totales(productos) };
      })
      .filter((g: Grupo) => g.productos.length);
  });
  readonly total = computed(() => this.totales(this.grupos().flatMap(g => g.productos)));

  constructor() {
    effect(() => {
      this.idSucursal(); this.fecha();
      untracked(() => this.cargar());
    });
  }

  private sumar(p: any, lotes: Lote[]): Fila {
    let cantidad = 0, sin_costo = 0, valor = 0, por_vencer = 0, vencidos = 0;
    for (const l of lotes) {
      cantidad += l.cantidad;
      if (l.costo_unitario == null) sin_costo += l.cantidad; else valor += l.cantidad * l.costo_unitario;
      if (l.estado === 'POR_VENCER') por_vencer += l.cantidad;
      if (l.estado === 'VENCIDO') vencidos += l.cantidad;
    }
    const conCosto = cantidad - sin_costo;
    return {
      clave: `${p.id_producto}-${p.id_sucursal}`, id_producto: p.id_producto, nombre_producto: p.nombre_producto,
      tipo_producto: p.tipo_producto, nombre_sucursal: p.nombre_sucursal, precio: p.precio, lotes,
      cantidad, sin_costo, por_vencer, vencidos,
      valor_costo: r2(valor), valor_venta: r2(cantidad * p.precio), ganancia: r2(conCosto * p.precio - valor),
      costo_promedio: conCosto ? Math.round(valor / conCosto * 10000) / 10000 : null
    };
  }

  private totales(productos: Fila[]): Totales {
    const t = { cantidad: 0, sin_costo: 0, valor_costo: 0, valor_venta: 0, ganancia: 0 };
    for (const p of productos) for (const k of Object.keys(t) as (keyof Totales)[]) t[k] += p[k];
    return { ...t, valor_costo: r2(t.valor_costo), valor_venta: r2(t.valor_venta), ganancia: r2(t.ganancia) };
  }

  cargar() {
    this.carga.set('cargando');
    this.reportes.inventarioValorado(this.idSucursal(), this.fecha()).subscribe({
      next:  (d) => { this.datos.set(d); this.carga.set('listo'); },
      error: () => this.carga.set('error')
    });
  }

  cambiarFecha(valor: string) {
    if (!valor) return;
    this.fecha.set(valor > this.hoy ? this.hoy : valor);
  }

  alternar(clave: string) {
    this.abiertos.update(s => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  }

  private get filtrosTexto(): string {
    const partes = [this.estados.find(e => e.id === this.estado())!.nombre, this.tipos.find(t => t.id === this.tipo())!.nombre,
                    this.categoria() || 'Todas las categorías'];
    return partes.join(' · ');
  }

  // ─── Descargas ───
  async exportarPDF() {
    const mon = this.moneda();
    const m = (n: number | null) => n == null ? 'sin costo' : `${mon} ${cifra(n).replace('−', '-')}`;
    const pdf = await nuevoPdf(this.ajustes, 'Inventario valorado (PEPS)', [
      `Fecha de corte: ${fechaDia(this.fecha())}`, `Sucursal: ${this.nombreSucursal()}`, `Filtros: ${this.filtrosTexto}`
    ], true);
    const t = this.total();
    pdf.seccion('Resumen');
    pdf.tabla(['Unidades', 'Valor al costo', 'Valor a precio de venta', 'Ganancia esperada', 'Sin costo conocido'],
      [[entero(t.cantidad), m(t.valor_costo), m(t.valor_venta), m(t.ganancia), `${entero(t.sin_costo)} u`]], [0, 1, 2, 3, 4]);
    for (const g of this.grupos()) {
      pdf.seccion(g.nombre);
      pdf.tabla([...(this.todas() ? ['Sucursal'] : []), 'Producto', 'Cantidad', 'Costo por unidad', 'Valor al costo', 'Precio', 'Valor a precio de venta', 'Ganancia esperada'],
        [...g.productos.map(p => [...(this.todas() ? [p.nombre_sucursal] : []), p.nombre_producto, entero(p.cantidad),
            p.costo_promedio == null ? 'sin costo' : m(p.costo_promedio), m(p.valor_costo), m(p.precio), m(p.valor_venta), m(p.ganancia)]),
         [...(this.todas() ? [''] : []), 'Total', entero(g.totales.cantidad), '', m(g.totales.valor_costo), '', m(g.totales.valor_venta), m(g.totales.ganancia)]],
        (this.todas() ? [2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]));
    }
    pdf.guardar(`Inventario_valorado_${nombreArchivo(this.ajustes)}_${this.fecha()}.pdf`);
  }

  async exportarExcel() {
    const XLSX = await import('xlsx');
    const mon = this.moneda();
    const filas: any[][] = [[`Inventario valorado al ${fechaDia(this.fecha())} · ${this.nombreSucursal()} · ${this.filtrosTexto}`], [],
      ['Categoría', 'Sucursal', 'Producto', 'Tipo', 'Cantidad', `Costo por unidad (${mon})`, `Valor al costo (${mon})`, `Precio (${mon})`,
       `Valor a precio de venta (${mon})`, `Ganancia esperada (${mon})`, 'Sin costo (u)', 'Por vencer (u)', 'Vencidos (u)']];
    for (const g of this.grupos())
      for (const p of g.productos)
        filas.push([g.nombre, p.nombre_sucursal, p.nombre_producto, p.tipo_producto, p.cantidad, p.costo_promedio ?? '', p.valor_costo,
                    p.precio, p.valor_venta, p.ganancia, p.sin_costo, p.por_vencer, p.vencidos]);
    const t = this.total();
    filas.push([], ['Total', '', '', '', t.cantidad, '', t.valor_costo, '', t.valor_venta, t.ganancia, t.sin_costo]);
    const lotes: any[][] = [['Producto', 'Sucursal', 'Lote', 'Ingreso', 'Vence', 'Estado', 'Cantidad', `Costo por unidad (${mon})`, `Valor (${mon})`]];
    for (const g of this.grupos())
      for (const p of g.productos)
        for (const l of p.lotes)
          lotes.push([p.nombre_producto, p.nombre_sucursal, l.id_lote, fechaHora(l.fecha_ingreso),
                      l.fecha_vencimiento ? fechaHora(l.fecha_vencimiento) : '', l.estado, l.cantidad, l.costo_unitario ?? '',
                      l.costo_unitario == null ? '' : r2(l.cantidad * l.costo_unitario)]);
    const wb = XLSX.utils.book_new();
    const hoja = (nombre: string, datos: any[][], anchos: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet(datos);
      ws['!cols'] = anchos.map(wch => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, nombre);
    };
    hoja('Inventario valorado', filas, [20, 18, 32, 12, 10, 16, 16, 12, 22, 20, 12, 12, 12]);
    hoja('Lotes', lotes, [32, 18, 8, 18, 18, 12, 10, 16, 12]);
    XLSX.writeFile(wb, `Inventario_valorado_${nombreArchivo(this.ajustes)}_${this.fecha()}.xlsx`);
  }
}
