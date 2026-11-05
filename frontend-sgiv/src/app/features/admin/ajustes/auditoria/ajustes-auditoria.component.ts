import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { LucideAngularModule, Search, X, RefreshCw, FileText, FileSpreadsheet, ChevronDown, Monitor, Globe } from 'lucide-angular';
import { AuditoriaService, Acceso, DetalleMovimiento, FiltrosAuditoria, Movimiento, OpcionesAuditoria }
  from '../../../../core/services/auditoria.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';
import { fechaDia, fechaHora, fechaLarga, hora } from '../../../../core/utils/informe';

type Vista = 'movimientos' | 'accesos';
type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango';

interface Dia<T> { clave: string; titulo: string; filas: T[] }

const MAX_EXPORTAR = 5000;

/** Fecha local → 'aaaa-mm-dd' */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/** Agrupa filas por día (vienen ordenadas de la más reciente a la más antigua) */
const porDia = <T extends { fecha: string }>(filas: T[]): Dia<T>[] => {
  const dias: Dia<T>[] = [];
  for (const f of filas) {
    const d = new Date(f.fecha);
    const clave = iso(d);
    if (dias.at(-1)?.clave !== clave) dias.push({ clave, titulo: fechaLarga(d), filas: [] });
    dias.at(-1)!.filas.push(f);
  }
  return dias;
};

// ─── Ajustes → Auditoría: movimientos (cada operación) y accesos (sesiones y eventos) ───
@Component({
  selector: 'app-ajustes-auditoria',
  standalone: true,
  imports: [LucideAngularModule, FondoModalDirective],
  templateUrl: './ajustes-auditoria.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css', './ajustes-auditoria.component.css']
})
export class AjustesAuditoriaComponent implements OnInit, OnDestroy {
  private auditoria = inject(AuditoriaService);
  private ajustes = inject(AjustesService);
  private dialogo = inject(DialogoService);

  readonly icons = { buscar: Search, cerrar: X, actualizar: RefreshCw, pdf: FileText, excel: FileSpreadsheet,
                     mas: ChevronDown, equipo: Monitor, red: Globe };
  readonly hora = hora;
  readonly fechaHora = fechaHora;

  readonly periodos: { id: Periodo; nombre: string }[] = [
    { id: 'hoy', nombre: 'Hoy' }, { id: 'ayer', nombre: 'Ayer' }, { id: 'semana', nombre: '7 días' },
    { id: 'mes', nombre: 'Este mes' }, { id: 'rango', nombre: 'Rango' }
  ];
  readonly acciones = [
    { id: 'crear', nombre: 'Creó / registró' }, { id: 'modificar', nombre: 'Modificó' }, { id: 'eliminar', nombre: 'Eliminó / desactivó' }
  ];

  readonly vista    = signal<Vista>('movimientos');
  readonly periodo  = signal<Periodo>('hoy');
  readonly filtros  = signal<FiltrosAuditoria>(this.filtrosVacios());
  readonly opciones = signal<OpcionesAuditoria | null>(null);

  readonly movimientos = signal<Movimiento[]>([]);
  readonly accesos     = signal<Acceso[]>([]);
  readonly siguiente   = signal<number | null>(null);
  readonly cargando    = signal(true);
  readonly cargandoMas = signal(false);
  readonly exportando  = signal(false);

  readonly detalle        = signal<DetalleMovimiento | null>(null);
  readonly abriendoDetalle = signal<string | null>(null);

  readonly diasMovimientos = computed(() => porDia(this.movimientos()));
  readonly diasAccesos     = computed(() => porDia(this.accesos()));
  readonly vacio = computed(() => this.vista() === 'movimientos' ? !this.movimientos().length : !this.accesos().length);

  readonly hayFiltros = computed(() => {
    const f = this.filtros();
    return !!(f.usuario || f.id_sucursal || f.modulo || f.accion || f.q || f.tipo !== 'eventos' || this.periodo() !== 'hoy');
  });

  private peticion?: Subscription;
  private esperaTexto?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.auditoria.opciones().subscribe({
      next: (o) => this.opciones.set(o),
      error: () => this.dialogo.error('No se pudieron cargar los filtros.')
    });
    this.cargar();
  }

  ngOnDestroy() {
    this.peticion?.unsubscribe();
    clearTimeout(this.esperaTexto);
  }

  private filtrosVacios(): FiltrosAuditoria {
    const hoy = iso(new Date());
    return { desde: hoy, hasta: hoy, usuario: '', id_sucursal: '', modulo: '', accion: '', tipo: 'eventos', q: '' };
  }

  // ─── Carga (la página siguiente se agrega; un filtro nuevo reemplaza) ───
  cargar(mas = false) {
    this.peticion?.unsubscribe();
    const antes = mas ? this.siguiente() : null;
    (mas ? this.cargandoMas : this.cargando).set(true);
    const fallo = () => {
      this.cargando.set(false); this.cargandoMas.set(false);
      this.dialogo.error('No se pudo cargar la auditoría.');
    };

    if (this.vista() === 'movimientos') {
      this.peticion = this.auditoria.movimientos(this.filtros(), antes).subscribe({
        next: (r) => {
          this.movimientos.update(l => mas ? [...l, ...r.movimientos] : r.movimientos);
          this.terminar(r.siguiente);
        },
        error: fallo
      });
    } else {
      this.peticion = this.auditoria.accesos(this.filtros(), antes).subscribe({
        next: (r) => {
          this.accesos.update(l => mas ? [...l, ...r.accesos] : r.accesos);
          this.terminar(r.siguiente);
        },
        error: fallo
      });
    }
  }

  private terminar(siguiente: number | null) {
    this.siguiente.set(siguiente);
    this.cargando.set(false);
    this.cargandoMas.set(false);
  }

  cambiarVista(v: Vista) {
    if (v === this.vista()) return;
    this.vista.set(v);
    this.movimientos.set([]);
    this.accesos.set([]);
    this.cargar();
  }

  // ─── Filtros ───
  elegirPeriodo(p: Periodo) {
    this.periodo.set(p);
    if (p === 'rango') return;
    const hoy = iso(new Date());
    const desde = p === 'hoy' ? hoy : p === 'ayer' ? diasAtras(1) : p === 'semana' ? diasAtras(6) : hoy.slice(0, 8) + '01';
    this.filtros.update(f => ({ ...f, desde, hasta: p === 'ayer' ? desde : hoy }));
    this.cargar();
  }

  cambiarFecha(campo: 'desde' | 'hasta', valor: string) {
    if (!valor) return;
    this.filtros.update(f => {
      const n = { ...f, [campo]: valor };
      return n.desde > n.hasta ? { ...n, desde: n.hasta, hasta: n.desde } : n;
    });
    this.cargar();
  }

  cambiar(campo: 'usuario' | 'id_sucursal' | 'modulo' | 'accion' | 'tipo', valor: string) {
    this.filtros.update(f => ({ ...f, [campo]: valor }));
    this.cargar();
  }

  buscar(texto: string) {
    this.filtros.update(f => ({ ...f, q: texto }));
    clearTimeout(this.esperaTexto);
    this.esperaTexto = setTimeout(() => this.cargar(), 350);
  }

  limpiar() {
    clearTimeout(this.esperaTexto);
    this.periodo.set('hoy');
    this.filtros.set(this.filtrosVacios());
    this.cargar();
  }

  // ─── Detalle de un movimiento ───
  abrir(m: Movimiento) {
    if (this.abriendoDetalle()) return;
    this.abriendoDetalle.set(m.id);
    this.auditoria.movimiento(m.id).subscribe({
      next: (d) => { this.abriendoDetalle.set(null); this.detalle.set(d); },
      error: (e) => { this.abriendoDetalle.set(null); this.dialogo.error(e?.error?.error || 'No se pudo abrir el movimiento.'); }
    });
  }

  cerrarDetalle() { this.detalle.set(null); }

  // ─── Descargas (con los filtros actuales) ───
  private textoFiltros(): string[] {
    const f = this.filtros(), o = this.opciones();
    const usuario = f.usuario.startsWith('u:')
      ? o?.usuarios.find(u => `u:${u.id_usuario}` === f.usuario)?.nombre_completo
      : { sistema: 'Sistema (automático)', cliente: 'Clientes del menú QR', directo: 'Directo en la base de datos' }[f.usuario];
    const lineas = [`Periodo: ${fechaDia(f.desde)}${f.hasta !== f.desde ? ` al ${fechaDia(f.hasta)}` : ''}`];
    if (usuario) lineas.push(`Usuario: ${usuario}`);
    if (this.vista() === 'movimientos') {
      const suc = o?.sucursales.find(s => String(s.id_sucursal) === f.id_sucursal)?.nombre_sucursal;
      const mod = o?.modulos.find(m => m.id === f.modulo)?.nombre;
      const acc = this.acciones.find(a => a.id === f.accion)?.nombre;
      if (suc) lineas.push(`Sucursal: ${suc}`);
      if (mod) lineas.push(`Módulo: ${mod}`);
      if (acc) lineas.push(`Acción: ${acc}`);
    } else {
      lineas.push(`Mostrar: ${o?.tipos_acceso.find(t => t.id === f.tipo)?.nombre ?? f.tipo}`);
    }
    if (f.q) lineas.push(`Búsqueda: ${f.q}`);
    return lineas;
  }

  /** Trae todas las filas del filtro actual (hasta MAX_EXPORTAR) */
  private async todasLasFilas(): Promise<{ cabecera: string[]; filas: string[][]; anchos: number[] }> {
    const f = this.filtros();
    let antes: number | null = null;
    if (this.vista() === 'movimientos') {
      const lista: Movimiento[] = [];
      do {
        const r: { movimientos: Movimiento[]; siguiente: number | null } = await firstValueFrom(this.auditoria.movimientos(f, antes, 500));
        lista.push(...r.movimientos);
        antes = r.siguiente;
      } while (antes && lista.length < MAX_EXPORTAR);
      return {
        cabecera: ['Fecha', 'Usuario', 'Acción', 'Detalle', 'Módulo', 'Sucursal', 'IP'],
        filas: lista.map(m => [fechaHora(m.fecha), m.usuario, m.accion, m.detalle, m.modulo, m.sucursal ?? '', m.ip ?? '']),
        anchos: [18, 22, 30, 70, 16, 16, 16]
      };
    }
    const lista: Acceso[] = [];
    do {
      const r: { accesos: Acceso[]; siguiente: number | null } = await firstValueFrom(this.auditoria.accesos(f, antes, 500));
      lista.push(...r.accesos);
      antes = r.siguiente;
    } while (antes && lista.length < MAX_EXPORTAR);
    return {
      cabecera: ['Fecha', 'Evento', 'Usuario', 'IP', 'Navegador', 'Detalle'],
      filas: lista.map(a => [fechaHora(a.fecha), a.texto + (a.veces > 1 ? ` (×${a.veces})` : ''), a.usuario, a.ip ?? '',
                             a.navegador ?? '', [a.evento === 'PETICION' ? a.ruta : '', a.detalle ?? ''].filter(Boolean).join(' · ')]),
      anchos: [18, 28, 26, 16, 20, 70]
    };
  }

  private get nombreArchivo() {
    const f = this.filtros();
    return `Auditoria_${this.vista() === 'movimientos' ? 'Movimientos' : 'Accesos'}_${f.desde}${f.hasta !== f.desde ? '_' + f.hasta : ''}`;
  }

  async descargarPDF() {
    if (this.exportando() || this.vacio()) return;
    this.exportando.set(true);
    try {
      const [{ cabecera, filas }, [{ default: jsPDF }, { default: autoTable }]] = await Promise.all([
        this.todasLasFilas(), Promise.all([import('jspdf'), import('jspdf-autotable')])
      ]);
      const doc = new jsPDF({ orientation: 'landscape' });
      const ancho = doc.internal.pageSize.getWidth();
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
      doc.text(`Auditoría — ${this.vista() === 'movimientos' ? 'Movimientos' : 'Accesos'}`, x, 23);
      doc.text(`Generado: ${fechaHora(new Date().toISOString())}`, ancho - 14, 17, { align: 'right' });
      doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.line(14, 30, ancho - 14, 30);
      doc.setFontSize(9); doc.setTextColor(51, 65, 85);
      const lineas = this.textoFiltros();
      lineas.forEach((l, i) => doc.text(l, 14, 37 + i * 5));
      autoTable(doc, {
        startY: 40 + lineas.length * 5, head: [cabecera], body: filas, theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.5, textColor: [51, 65, 85], lineColor: [226, 232, 240], overflow: 'linebreak' },
        headStyles: { fillColor: color, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: this.vista() === 'movimientos'
          ? { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 2: { cellWidth: 40 }, 4: { cellWidth: 24 }, 5: { cellWidth: 24 }, 6: { cellWidth: 24 } }
          : { 0: { cellWidth: 24 }, 1: { cellWidth: 40 }, 2: { cellWidth: 40 }, 3: { cellWidth: 26 }, 4: { cellWidth: 30 } }
      });
      doc.save(`${this.nombreArchivo}.pdf`);
    } catch {
      this.dialogo.error('No se pudo generar el PDF.');
    } finally {
      this.exportando.set(false);
    }
  }

  async descargarExcel() {
    if (this.exportando() || this.vacio()) return;
    this.exportando.set(true);
    try {
      const [{ cabecera, filas, anchos }, XLSX] = await Promise.all([this.todasLasFilas(), import('xlsx')]);
      const hoja = XLSX.utils.aoa_to_sheet([
        [`AUDITORÍA — ${this.vista() === 'movimientos' ? 'MOVIMIENTOS' : 'ACCESOS'} — ${this.ajustes.nombre()}`],
        ...this.textoFiltros().map(l => [l]),
        [`Generado: ${fechaHora(new Date().toISOString())}`],
        [],
        cabecera,
        ...filas
      ]);
      hoja['!cols'] = anchos.map(wch => ({ wch }));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, this.vista() === 'movimientos' ? 'Movimientos' : 'Accesos');
      XLSX.writeFile(libro, `${this.nombreArchivo}.xlsx`);
    } catch {
      this.dialogo.error('No se pudo generar el Excel.');
    } finally {
      this.exportando.set(false);
    }
  }
}
