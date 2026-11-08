import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { LucideAngularModule, FileSpreadsheet, FileText } from 'lucide-angular';
import { ReporteService } from '../../../../core/services/reporte.service';
import { ProductoService } from '../../../../core/services/producto.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { agruparPorCategoria } from '../../../../core/utils/categorias';
import { cifra, entero, fechaDia, fechaHora } from '../../../../core/utils/informe';
import { nombreArchivo, nuevoPdf } from '../pdf-reporte';

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
const inicioDeMes = () => `${hoy().slice(0, 8)}01`;

// ─── Reportes → «Kardex»: entradas, salidas y saldo de un producto, en cantidad y en dinero (PEPS) ───
@Component({
  selector: 'app-kardex',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './kardex.component.html',
  styleUrls: ['../../../shared/informe/informe.css']
})
export class KardexComponent {
  private reportes  = inject(ReporteService);
  private productos = inject(ProductoService);
  private ajustes   = inject(AjustesService);
  readonly moneda   = this.ajustes.moneda;

  readonly idSucursal     = input.required<number>();   // 0 = todas: el kardex es de una sucursal
  readonly nombreSucursal = input('');

  readonly icons = { excel: FileSpreadsheet, pdf: FileText };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly fechaHora = fechaHora;
  readonly hoy = hoy();

  readonly lista      = signal<any[]>([]);
  readonly idProducto = signal<number | null>(null);
  readonly desde      = signal(inicioDeMes());
  readonly hasta      = signal(hoy());
  readonly datos      = signal<any>(null);
  readonly carga      = signal<'esperando' | 'cargando' | 'listo' | 'error'>('esperando');

  /** Productos con stock por lotes (lo preparado al momento no tiene kardex), por categoría */
  readonly secciones = computed(() => agruparPorCategoria(this.lista().filter(p => p.tipo_producto !== 'PREPARADO'),
                                                         { stockPrimero: false }));

  constructor() {
    effect(() => {
      const id = this.idSucursal();
      untracked(() => {
        this.datos.set(null);
        this.carga.set('esperando');
        if (!id) return;
        this.productos.obtenerInventario(id, true).subscribe({
          next: (l) => {
            this.lista.set(l || []);
            if (this.idProducto() && !(l || []).some(p => Number(p.id_producto) === this.idProducto())) this.idProducto.set(null);
            this.cargar();
          }
        });
      });
    });
  }

  elegirProducto(valor: string) {
    this.idProducto.set(Number(valor) || null);
    this.cargar();
  }

  cambiarFecha(cual: 'desde' | 'hasta', valor: string) {
    if (!valor) return;
    const v = valor > this.hoy ? this.hoy : valor;
    (cual === 'desde' ? this.desde : this.hasta).set(v);
    if (this.desde() > this.hasta()) (cual === 'desde' ? this.hasta : this.desde).set(v);
    this.cargar();
  }

  cargar() {
    const id = this.idProducto();
    if (!id || !this.idSucursal()) { this.datos.set(null); this.carga.set('esperando'); return; }
    this.carga.set('cargando');
    this.reportes.kardex(this.idSucursal(), id, this.desde(), this.hasta()).subscribe({
      next:  (d) => { this.datos.set(d); this.carga.set('listo'); },
      error: () => this.carga.set('error')
    });
  }

  /** Detalle del movimiento: motivo · observación */
  detalle(m: any): string { return [m.motivo, m.detalle].filter(Boolean).join(' · '); }

  // ─── Descargas ───
  private get titulo(): string {
    const p = this.datos()?.producto;
    return `${p?.nombre_producto} · ${this.nombreSucursal()} · ${fechaDia(this.desde())} al ${fechaDia(this.hasta())}`;
  }

  async exportarPDF() {
    const d = this.datos();
    if (!d) return;
    const mon = this.moneda();
    const m = (n: number | null) => n == null ? '—' : cifra(n).replace('−', '-');
    const pdf = await nuevoPdf(this.ajustes, 'Kardex (método PEPS)', [
      `Producto: ${d.producto.nombre_producto} (${d.producto.nombre_categoria})`, `Sucursal: ${this.nombreSucursal()}`,
      `Período: ${fechaDia(this.desde())} al ${fechaDia(this.hasta())} · Valores en ${mon}`
    ], true);
    const vacio = ['', '', ''];
    const filas = [
      ['', 'Saldo inicial', ...vacio, ...vacio, entero(d.inicial.cantidad), '', m(d.inicial.valor)],
      ...d.movimientos.map((x: any) => {
        const mov = [entero(x.cantidad), m(x.costo_unitario), m(x.total)];
        return [fechaHora(x.fecha), this.detalle(x), ...(x.tipo === 'INGRESO' ? mov : vacio), ...(x.tipo === 'INGRESO' ? vacio : mov),
                entero(x.saldo.cantidad), x.saldo.valor == null || !x.saldo.cantidad ? '' : m(x.saldo.valor / x.saldo.cantidad), m(x.saldo.valor)];
      }),
      ['', 'Totales', entero(d.totales.entradas), '', m(d.totales.valor_entradas), entero(d.totales.salidas), '', m(d.totales.valor_salidas),
       entero(d.final.cantidad), '', m(d.final.valor)]
    ];
    pdf.tabla(['Fecha', 'Detalle', 'Entra', 'C. unit.', 'Total', 'Sale', 'C. unit.', 'Total', 'Saldo', 'C. unit.', 'Total'],
      filas, [2, 3, 4, 5, 6, 7, 8, 9, 10], { columnStyles: { 1: { cellWidth: 70 } } });
    pdf.guardar(`Kardex_${nombreArchivo(this.ajustes)}_${d.producto.id_producto}_${this.desde()}_${this.hasta()}.pdf`);
  }

  async exportarExcel() {
    const d = this.datos();
    if (!d) return;
    const XLSX = await import('xlsx');
    const mon = this.moneda();
    const filas: any[][] = [[`Kardex (PEPS) · ${this.titulo}`], [],
      ['Fecha', 'Detalle', 'Usuario', 'Entrada', `C. unit. entrada (${mon})`, `Total entrada (${mon})`, 'Salida',
       `C. unit. salida (${mon})`, `Total salida (${mon})`, 'Saldo', `Valor del saldo (${mon})`],
      ['', 'Saldo inicial', '', '', '', '', '', '', '', d.inicial.cantidad, d.inicial.valor ?? '']];
    for (const x of d.movimientos) {
      const entra = x.tipo === 'INGRESO';
      filas.push([fechaHora(x.fecha), this.detalle(x), x.usuario || '',
                  entra ? x.cantidad : '', entra ? x.costo_unitario ?? '' : '', entra ? x.total ?? '' : '',
                  entra ? '' : x.cantidad, entra ? '' : x.costo_unitario ?? '', entra ? '' : x.total ?? '',
                  x.saldo.cantidad, x.saldo.valor ?? '']);
    }
    filas.push(['', 'Totales', '', d.totales.entradas, '', d.totales.valor_entradas, d.totales.salidas, '', d.totales.valor_salidas,
                d.final.cantidad, d.final.valor ?? '']);
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [18, 40, 20, 9, 14, 14, 9, 14, 14, 9, 16].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kardex');
    XLSX.writeFile(wb, `Kardex_${nombreArchivo(this.ajustes)}_${d.producto.id_producto}_${this.desde()}_${this.hasta()}.xlsx`);
  }
}
