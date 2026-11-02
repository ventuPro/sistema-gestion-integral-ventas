import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X, Printer, FileText, FileSpreadsheet, Check } from 'lucide-angular';
import { ProductoService } from '../../../../core/services/producto.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { ImpresionService } from '../../../../core/services/impresion.service';
import { fechaLarga, hora } from '../../../../core/utils/informe';
import { GrupoListaDia, TicketListaDiaComponent } from '../../../shared/ticket/ticket-lista-dia.component';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';
import { SelectorSucursalComponent } from '../../../shared/selector-sucursal/selector-sucursal.component';

type FiltroStock = 'todos' | 'con' | 'sin' | 'bajo';

// ─── Inventario → «Descargar»: stock actual en ticket, PDF o Excel, con filtros (para todos los usuarios) ───
@Component({
  selector: 'app-descarga-inventario',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, LucideAngularModule, TicketListaDiaComponent, SelectorSucursalComponent],
  templateUrl: './descarga-inventario.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css', './descarga-inventario.component.css']
})
export class DescargaInventarioComponent implements OnInit {
  private productosApi = inject(ProductoService);
  private dialogo      = inject(DialogoService);
  private impresion    = inject(ImpresionService);
  private ajustes      = inject(AjustesService);

  /** Sucursales que puede elegir (el cajero solo la suya) y la que está viendo en Inventario */
  readonly sucursales = input<any[]>([]);
  readonly idInicial  = input.required<number>({ alias: 'idSucursal' });
  readonly cerrar     = output<void>();

  readonly icons = { cerrar: X, ticket: Printer, pdf: FileText, excel: FileSpreadsheet, listo: Check };
  readonly filtrosStock: { valor: FiltroStock; texto: string }[] = [
    { valor: 'todos', texto: 'Todos' },
    { valor: 'con',   texto: 'Con stock' },
    { valor: 'bajo',  texto: 'Stock bajo' },
    { valor: 'sin',   texto: 'Agotados' }
  ];

  readonly idSucursal = signal(0);
  readonly productos  = signal<any[]>([]);
  readonly estado     = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly filtro     = signal<FiltroStock>('todos');
  readonly elegidas   = signal<ReadonlySet<number>>(new Set());
  readonly ocupado    = signal(false);
  readonly generado   = signal(new Date());
  private zonaTicket  = viewChild<ElementRef<HTMLElement>>('zonaTicket');

  readonly nombreSucursal = computed(() =>
    this.sucursales().find(s => Number(s.id_sucursal) === this.idSucursal())?.nombre_sucursal ?? '');

  /** Mismo criterio que la lista de Inventario: agotado = 0; bajo = hasta el mínimo de alerta */
  private estadoDe(p: any): 'sin' | 'bajo' | 'ok' {
    const stock = Number(p.stock_actual) || 0;
    if (stock <= 0) return 'sin';
    return stock <= Number(p.stock_minimo_alerta ?? 0) ? 'bajo' : 'ok';
  }

  /** Productos activos que pasan el filtro de stock */
  private readonly filtrados = computed(() => {
    const f = this.filtro();
    return this.productos().filter(p => p.estado_activo !== false && (f === 'todos'
      || (f === 'con' && this.estadoDe(p) !== 'sin')
      || this.estadoDe(p) === f));
  });

  /** Categorías en el orden del menú, con cuántos productos tienen con el filtro actual */
  readonly categorias = computed(() => {
    const mapa = new Map<number, { id: number; nombre: string; productos: number }>();
    for (const p of this.filtrados()) {
      const id = Number(p.id_categoria);
      const c = mapa.get(id) ?? { id, nombre: p.nombre_categoria || 'SIN CATEGORÍA', productos: 0 };
      c.productos++;
      mapa.set(id, c);
    }
    return [...mapa.values()];   // el backend ya los trae en el orden de las categorías
  });

  readonly todas = computed(() => this.categorias().length > 0 && this.categorias().every(c => this.elegidas().has(c.id)));

  readonly grupos = computed<GrupoListaDia[]>(() => this.categorias()
    .filter(c => this.elegidas().has(c.id))
    .map(c => ({
      categoria: c.nombre,
      items: this.filtrados().filter(p => Number(p.id_categoria) === c.id)
        .map(p => ({ nombre_producto: p.nombre_producto, cantidad: Number(p.stock_actual) || 0 }))
    })));

  readonly totales = computed(() => this.grupos().reduce((t, g) =>
    ({ productos: t.productos + g.items.length, unidades: t.unidades + g.items.reduce((s, i) => s + i.cantidad, 0) }),
    { productos: 0, unidades: 0 }));

  readonly fechaTexto = computed(() => `${fechaLarga(this.generado())} ${hora(this.generado())}`);

  ngOnInit() {
    this.idSucursal.set(this.idInicial());
    this.cargar();
  }

  cambiarSucursal(id: number | null) {
    if (!id || id === this.idSucursal()) return;
    this.idSucursal.set(id);
    this.cargar();
  }

  cambiarFiltro(f: FiltroStock) {
    this.filtro.set(f);
    this.elegidas.set(new Set(this.categorias().map(c => c.id)));
  }

  private cargar() {
    this.estado.set('cargando');
    this.productosApi.obtenerInventario(this.idSucursal()).subscribe({
      next: (lista) => {
        this.productos.set(lista || []);
        this.generado.set(new Date());
        this.elegidas.set(new Set(this.categorias().map(c => c.id)));
        this.estado.set('listo');
      },
      error: () => this.estado.set('error')
    });
  }

  alternar(id: number) {
    this.elegidas.update(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  alternarTodas() {
    this.elegidas.set(this.todas() ? new Set() : new Set(this.categorias().map(c => c.id)));
  }

  imprimirTicket() {
    if (!this.totales().productos) return;
    // Espera a que se pinte el ticket con las categorías elegidas
    requestAnimationFrame(() => this.impresion.imprimirTicket(this.zonaTicket()?.nativeElement, this.ajustes.config().ticket_ancho));
  }

  private get nombreArchivo(): string {
    const f = this.generado();
    const dia = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    return `Inventario_${this.nombreSucursal().replace(/[^\p{L}\p{N}]+/gu, '_')}_${dia}`;
  }

  private get textoFiltro(): string {
    return this.filtrosStock.find(f => f.valor === this.filtro())!.texto;
  }

  async descargarPDF() {
    if (!this.totales().productos || this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const doc = new jsPDF();
      const color = this.ajustes.colorPrimarioRgb();

      const logo = await this.ajustes.logoComoDataUri();
      let x = 14;
      if (logo) {
        try { doc.addImage(logo, 14, 10, 16, 16, undefined, 'FAST'); x = 34; } catch { /* formato no soportado */ }
      }
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(this.ajustes.nombre(), x, 17);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(100, 116, 139);
      doc.text('Inventario', x, 23);
      doc.text(`Generado: ${this.fechaTexto()}`, 196, 17, { align: 'right' });
      doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.line(14, 30, 196, 30);
      doc.setFontSize(9); doc.setTextColor(51, 65, 85);
      doc.text(`Sucursal: ${this.nombreSucursal()}`, 14, 37);
      doc.text(`Productos: ${this.textoFiltro}`, 14, 42);

      const body: any[] = [];
      for (const g of this.grupos()) {
        body.push([{ content: g.categoria, colSpan: 3, styles: { fontStyle: 'bold', textColor: color, fillColor: [248, 250, 252] } }]);
        for (const i of g.items) body.push([i.nombre_producto, i.cantidad, '']);
      }
      body.push([{ content: 'Total de unidades', styles: { fontStyle: 'bold' } },
                 { content: this.totales().unidades, styles: { fontStyle: 'bold' } }, '']);
      autoTable(doc, {
        startY: 48, head: [['Producto', 'Stock', 'Contado']], body, theme: 'grid',
        styles: { fontSize: 9, cellPadding: 1.8, textColor: [51, 65, 85], lineColor: [226, 232, 240] },
        headStyles: { fillColor: color, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right', cellWidth: 26 }, 2: { cellWidth: 30 } }
      });
      doc.save(`${this.nombreArchivo}.pdf`);
    } catch {
      this.dialogo.error('No se pudo generar el PDF.');
    } finally {
      this.ocupado.set(false);
    }
  }

  async descargarExcel() {
    if (!this.totales().productos || this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const XLSX = await import('xlsx');
      const filas: any[][] = [
        [`INVENTARIO — ${this.ajustes.nombre()}`],
        ['Sucursal', this.nombreSucursal()],
        ['Productos', this.textoFiltro],
        ['Generado', this.fechaTexto()],
        [],
        ['Categoría', 'Producto', 'Stock']
      ];
      for (const g of this.grupos()) for (const i of g.items) filas.push([g.categoria, i.nombre_producto, i.cantidad]);
      filas.push([], ['', 'Total de unidades', this.totales().unidades]);
      const ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
      XLSX.writeFile(wb, `${this.nombreArchivo}.xlsx`);
    } catch {
      this.dialogo.error('No se pudo generar el Excel.');
    } finally {
      this.ocupado.set(false);
    }
  }
}
