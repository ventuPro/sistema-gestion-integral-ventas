import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { LucideAngularModule, ArrowRightLeft, ArrowRight, Search, X, Printer, Trash2 } from 'lucide-angular';
import { InventarioService, Transferencia } from '../../../../core/services/inventario.service';
import { SocketService } from '../../../../core/services/socket.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { ImpresionService } from '../../../../core/services/impresion.service';
import { ComprobanteTransferenciaComponent } from '../../../shared/ticket/comprobante-transferencia.component';
import { environment } from '../../../../../environments/environment';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

interface Linea { id_producto: number; nombre_producto: string; disponible: number; cantidad: number }

// ─── Inventario → Transferencias: el stock sale de esta sucursal y entra a otra al instante ───
@Component({
  selector: 'app-transferencias',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, FormsModule, LucideAngularModule, ComprobanteTransferenciaComponent],
  templateUrl: './transferencias.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', './transferencias.component.css']
})
export class TransferenciasComponent implements OnInit, OnDestroy {
  private inventario = inject(InventarioService);
  private socket     = inject(SocketService);
  private dialogo    = inject(DialogoService);
  private impresion  = inject(ImpresionService);
  private ajustes    = inject(AjustesService);
  private http       = inject(HttpClient);

  /** Sucursal elegida en Inventario (origen de las nuevas transferencias) */
  readonly idSucursal = input.required<number>();
  /** Productos de esa sucursal con su stock (los mantiene al día Inventario) */
  readonly productos  = input.required<any[]>();

  readonly icons = { transferir: ArrowRightLeft, hacia: ArrowRight, buscar: Search, cerrar: X,
                     imprimir: Printer, quitar: Trash2 };

  // ─── Historial ───
  readonly lista    = signal<Transferencia[]>([]);
  readonly cargando = signal(false);
  readonly periodo  = signal<'hoy' | '7' | '30'>('7');

  // ─── Nueva transferencia ───
  readonly sucursales = signal<{ id_sucursal: number; nombre_sucursal: string; estado_activo?: boolean }[]>([]);
  readonly nueva      = signal(false);
  readonly destino    = signal<number | null>(null);
  readonly lineas     = signal<Linea[]>([]);
  readonly observacion = signal('');
  readonly busqueda   = signal('');
  readonly enviando   = signal(false);
  readonly errorNueva = signal('');

  readonly destinos = computed(() =>
    this.sucursales().filter(s => s.estado_activo !== false && s.id_sucursal !== this.idSucursal()));

  readonly sugerencias = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return [];
    const elegidos = new Set(this.lineas().map(l => l.id_producto));
    return this.productos()
      .filter(p => p.estado_activo && Number(p.stock_actual) > 0 && !elegidos.has(Number(p.id_producto))
                   && p.nombre_producto.toLowerCase().includes(texto))
      .slice(0, 8);
  });

  readonly unidades = computed(() => this.lineas().reduce((s, l) => s + (Number(l.cantidad) || 0), 0));

  // ─── Detalle y comprobante ───
  readonly detalle = signal<Transferencia | null>(null);
  private zonaComprobante = viewChild<ElementRef<HTMLElement>>('zonaComprobante');

  private subs: Subscription[] = [];
  private recarga: any;

  constructor() {
    // Al cambiar de sucursal en Inventario se recarga su historial
    effect(() => { this.idSucursal(); untracked(() => this.cargar()); });
    // El stock disponible de cada línea sigue al de la sucursal en tiempo real
    effect(() => {
      const stock = new Map(this.productos().map(p => [Number(p.id_producto), Number(p.stock_actual) || 0]));
      untracked(() => this.lineas.update(ls => ls.map(l => ({ ...l, disponible: stock.get(l.id_producto) ?? 0 }))));
    });
  }

  ngOnInit() {
    this.socket.conectar('cajeros');
    this.subs.push(this.socket.escuchar<any>('transferencia:nueva').subscribe(d => {
      const id = this.idSucursal();
      if (Number(d?.id_sucursal_origen) !== id && Number(d?.id_sucursal_destino) !== id) return;
      clearTimeout(this.recarga);
      this.recarga = setTimeout(() => this.cargar(), 300);
    }));
    this.http.get<any[]>(`${environment.apiUrl}/sucursales`).subscribe({ next: (s) => this.sucursales.set(s || []) });
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    clearTimeout(this.recarga);
  }

  cargar() {
    const dias  = { hoy: 0, '7': 6, '30': 29 }[this.periodo()];
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    this.cargando.set(true);
    this.inventario.listarTransferencias({ id_sucursal: this.idSucursal(), desde: desde.toLocaleDateString('en-CA') }).subscribe({
      next:  (l) => { this.lista.set(l); this.cargando.set(false); },
      error: () => { this.lista.set([]); this.cargando.set(false); this.dialogo.error('No se pudieron cargar las transferencias.'); }
    });
  }

  cambiarPeriodo(p: 'hoy' | '7' | '30') { this.periodo.set(p); this.cargar(); }

  /** Salida (de esta sucursal) o entrada */
  esSalida(t: Transferencia): boolean { return t.id_sucursal_origen === this.idSucursal(); }

  // ─── Nueva transferencia ───
  abrirNueva() {
    this.destino.set(this.destinos().length === 1 ? this.destinos()[0].id_sucursal : null);
    this.lineas.set([]);
    this.observacion.set('');
    this.busqueda.set('');
    this.errorNueva.set('');
    this.nueva.set(true);
  }

  cerrarNueva() { if (!this.enviando()) this.nueva.set(false); }

  agregar(p: any) {
    this.lineas.update(ls => [...ls, { id_producto: Number(p.id_producto), nombre_producto: p.nombre_producto,
                                       disponible: Number(p.stock_actual) || 0, cantidad: 1 }]);
    this.busqueda.set('');
  }

  cambiarCantidad(linea: Linea, valor: any) {
    const n = Math.max(0, Math.floor(Number(valor) || 0));
    this.lineas.update(ls => ls.map(l => l.id_producto === linea.id_producto ? { ...l, cantidad: n } : l));
  }

  quitar(linea: Linea) { this.lineas.update(ls => ls.filter(l => l.id_producto !== linea.id_producto)); }

  async transferir() {
    const destino = this.destinos().find(s => s.id_sucursal === this.destino());
    const lineas = this.lineas();
    if (!destino) return this.errorNueva.set('Elige la sucursal de destino.');
    if (!lineas.length) return this.errorNueva.set('Agrega al menos un producto.');
    const invalida = lineas.find(l => !l.cantidad || l.cantidad > l.disponible);
    if (invalida) return this.errorNueva.set(invalida.cantidad
      ? `Solo hay ${invalida.disponible} de "${invalida.nombre_producto}".`
      : `Escribe la cantidad de "${invalida.nombre_producto}".`);
    this.errorNueva.set('');

    const resumen = lineas.map(l => `${l.cantidad} ${l.nombre_producto}`).join(', ');
    const si = await this.dialogo.confirmar({
      titulo: `¿Transferir a ${destino.nombre_sucursal}?`,
      mensaje: resumen,
      textoConfirmar: 'Transferir'
    });
    if (!si) return;

    this.enviando.set(true);
    this.inventario.transferir({
      id_sucursal_origen: this.idSucursal(), id_sucursal_destino: destino.id_sucursal,
      items: lineas.map(l => ({ id_producto: l.id_producto, cantidad: l.cantidad })),
      observacion: this.observacion().trim() || null
    }).subscribe({
      next: (r) => {
        this.enviando.set(false);
        this.nueva.set(false);
        this.dialogo.avisar(r.mensaje);
        this.cargar();
        this.ver(r.id_transferencia);
      },
      error: (e) => {
        this.enviando.set(false);
        this.errorNueva.set(e?.error?.error || 'No se pudo registrar la transferencia.');
      }
    });
  }

  // ─── Detalle ───
  ver(id: number) {
    this.inventario.obtenerTransferencia(id).subscribe({
      next:  (t) => this.detalle.set(t),
      error: () => this.dialogo.error('No se pudo abrir la transferencia.')
    });
  }

  imprimir() {
    this.impresion.imprimirTicket(this.zonaComprobante()?.nativeElement, this.ajustes.config().ticket_ancho);
  }
}
