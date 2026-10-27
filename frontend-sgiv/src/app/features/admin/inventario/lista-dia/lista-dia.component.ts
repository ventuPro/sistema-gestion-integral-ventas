import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { LucideAngularModule, X, Printer, FileText, FileSpreadsheet, Lock, Check } from 'lucide-angular';
import { InventarioService, ListaDia } from '../../../../core/services/inventario.service';
import { SocketService } from '../../../../core/services/socket.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { ImpresionService } from '../../../../core/services/impresion.service';
import { SesionService } from '../../../../core/services/sesion.service';
import { fechaLarga, hora } from '../../../../core/utils/informe';
import { GrupoListaDia, TicketListaDiaComponent } from '../../../shared/ticket/ticket-lista-dia.component';

// ─── Inventario → «Lista del día anterior»: ticket, PDF o Excel por categorías ───
@Component({
  selector: 'app-lista-dia',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TicketListaDiaComponent],
  templateUrl: './lista-dia.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css', './lista-dia.component.css']
})
export class ListaDiaComponent implements OnInit, OnDestroy {
  private inventario = inject(InventarioService);
  private socket     = inject(SocketService);
  private dialogo    = inject(DialogoService);
  private impresion  = inject(ImpresionService);
  private ajustes    = inject(AjustesService);
  readonly esAdmin   = inject(SesionService).esAdmin;

  readonly idSucursal = input.required<number>();
  readonly cerrar     = output<void>();

  readonly icons = { cerrar: X, ticket: Printer, pdf: FileText, excel: FileSpreadsheet, bloqueo: Lock, listo: Check };

  readonly lista     = signal<ListaDia | null>(null);
  readonly estado    = signal<'cargando' | 'listo' | 'vacio' | 'error'>('cargando');
  readonly elegidas  = signal<ReadonlySet<number>>(new Set());
  readonly ocupado   = signal(false);
  private zonaTicket = viewChild<ElementRef<HTMLElement>>('zonaTicket');
  private sub?: Subscription;

  /** Categorías en el orden del menú, con cuántos productos y unidades tienen */
  readonly categorias = computed(() => {
    const mapa = new Map<number, { id: number; nombre: string; orden: number; productos: number; unidades: number }>();
    for (const i of this.lista()?.items || []) {
      const c = mapa.get(i.id_categoria) ?? { id: i.id_categoria, nombre: i.nombre_categoria, orden: i.orden_categoria, productos: 0, unidades: 0 };
      c.productos++;
      c.unidades += i.cantidad;
      mapa.set(i.id_categoria, c);
    }
    return [...mapa.values()].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  });

  readonly todas = computed(() => this.categorias().length > 0 && this.categorias().every(c => this.elegidas().has(c.id)));

  readonly grupos = computed<GrupoListaDia[]>(() => this.categorias()
    .filter(c => this.elegidas().has(c.id))
    .map(c => ({ categoria: c.nombre, items: (this.lista()?.items || []).filter(i => i.id_categoria === c.id) })));

  readonly totales = computed(() => this.grupos().reduce((t, g) =>
    ({ productos: t.productos + g.items.length, unidades: t.unidades + g.items.reduce((s, i) => s + i.cantidad, 0) }),
    { productos: 0, unidades: 0 }));

  /** El cajero no ve la lista si ya hubo ventas hoy (salvo acceso del administrador) */
  readonly sinAcceso = computed(() => !this.esAdmin() && !!this.lista()?.bloqueada);

  readonly fechaTexto = computed(() => {
    const f = this.lista()?.fecha;
    return f ? fechaLarga(new Date(`${f}T12:00:00`)) : '';
  });

  ngOnInit() {
    this.cargar(true);
    this.socket.conectar('cajeros');
    this.sub = this.socket.escuchar<any>('lista_dia:actualizada').subscribe(d => {
      if (!d?.id_sucursal || Number(d.id_sucursal) === this.idSucursal()) this.cargar();
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  cargar(primeraVez = false) {
    this.inventario.listaDia(this.idSucursal()).subscribe({
      next: (l) => {
        this.lista.set(l);
        if (primeraVez || !this.elegidas().size) this.elegidas.set(new Set(this.categorias().map(c => c.id)));
        this.estado.set('listo');
      },
      error: (e) => this.estado.set(e?.status === 404 ? 'vacio' : 'error')
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

  async darAcceso() {
    const l = this.lista();
    if (!l) return;
    const si = await this.dialogo.confirmar({
      titulo: '¿Dar acceso al cajero?',
      mensaje: `El cajero de ${l.nombre_sucursal} podrá volver a imprimir y descargar la lista de hoy.`,
      textoConfirmar: 'Dar acceso'
    });
    if (!si) return;
    this.inventario.desbloquearListaDia(l.id_foto).subscribe({
      next: (r) => { this.dialogo.avisar(r.mensaje); this.cargar(); },
      error: (e) => this.dialogo.error(e?.error?.error || 'No se pudo dar acceso.')
    });
  }

  // ─── Salidas: antes de cada una se vuelve a consultar (si hubo una venta, el cajero queda bloqueado) ───
  private async vigente(): Promise<boolean> {
    if (this.esAdmin()) return true;
    try {
      const l = await firstValueFrom(this.inventario.listaDia(this.idSucursal()));
      this.lista.set(l);
      if (!l.bloqueada) return true;
    } catch { /* sin conexión: se avisa abajo */ }
    this.dialogo.error('La lista ya no está disponible: hubo ventas hoy. Pide acceso al administrador.');
    return false;
  }

  async imprimirTicket() {
    if (!this.totales().productos || !(await this.vigente())) return;
    // Espera a que se pinte el ticket con las categorías elegidas
    requestAnimationFrame(() => this.impresion.imprimirTicket(this.zonaTicket()?.nativeElement, this.ajustes.config().ticket_ancho));
  }

  private get nombreArchivo(): string {
    const l = this.lista()!;
    return `Productos_${l.nombre_sucursal.replace(/[^\p{L}\p{N}]+/gu, '_')}_${l.fecha}`;
  }

  async descargarPDF() {
    if (!this.totales().productos || this.ocupado() || !(await this.vigente())) return;
    this.ocupado.set(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const l = this.lista()!;
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
      doc.text('Productos que quedaron', x, 23);
      doc.text(`Generado: ${fechaLarga(new Date())} ${hora(new Date())}`, 196, 17, { align: 'right' });
      doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.line(14, 30, 196, 30);
      doc.setFontSize(9); doc.setTextColor(51, 65, 85);
      doc.text(`Sucursal: ${l.nombre_sucursal}`, 14, 37);
      doc.text(`Cierre del día: ${this.fechaTexto()}`, 14, 42);

      const body: any[] = [];
      for (const g of this.grupos()) {
        body.push([{ content: g.categoria, colSpan: 3, styles: { fontStyle: 'bold', textColor: color, fillColor: [248, 250, 252] } }]);
        for (const i of g.items) body.push([i.nombre_producto, i.cantidad, '']);
      }
      body.push([{ content: 'Total de unidades', styles: { fontStyle: 'bold' } },
                 { content: this.totales().unidades, styles: { fontStyle: 'bold' } }, '']);
      autoTable(doc, {
        startY: 48, head: [['Producto', 'Cantidad', 'Contado']], body, theme: 'grid',
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
    if (!this.totales().productos || this.ocupado() || !(await this.vigente())) return;
    this.ocupado.set(true);
    try {
      const XLSX = await import('xlsx');
      const l = this.lista()!;
      const filas: any[][] = [
        [`PRODUCTOS QUE QUEDARON — ${this.ajustes.nombre()}`],
        ['Sucursal', l.nombre_sucursal],
        ['Cierre del día', l.fecha],
        [],
        ['Categoría', 'Producto', 'Cantidad']
      ];
      for (const g of this.grupos()) for (const i of g.items) filas.push([g.categoria, i.nombre_producto, i.cantidad]);
      filas.push([], ['', 'Total de unidades', this.totales().unidades]);
      const ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Productos');
      XLSX.writeFile(wb, `${this.nombreArchivo}.xlsx`);
    } catch {
      this.dialogo.error('No se pudo generar el Excel.');
    } finally {
      this.ocupado.set(false);
    }
  }
}
