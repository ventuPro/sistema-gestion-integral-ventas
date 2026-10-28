import { afterNextRender, Component, Input, Output, EventEmitter, OnInit, OnDestroy, computed, effect, inject, Injector, signal, untracked, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CuentaService } from '../../../../core/services/cuenta.service';
import { SocketService } from '../../../../core/services/socket.service';
import { Subscription } from 'rxjs';
import { ImagenUrlPipe } from '../../../../core/pipes/imagen-url.pipe';
import { TicketComponent } from '../../../shared/ticket/ticket.component';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { ImpresionService } from '../../../../core/services/impresion.service';
import { cifra } from '../../../../core/utils/informe';
import { LucideAngularModule, X, Search, Trash2, ShoppingCart, Banknote, QrCode, Check, Printer, Download, User, BadgePercent, Minus, Plus } from 'lucide-angular';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { METODO_PAGO, MetodoPago } from '../../../../core/utils/metodos-pago';
import { Cotizacion, DescuentoManual, FormDescuento, PromocionService } from '../../../../core/services/promocion.service';
import { SesionService } from '../../../../core/services/sesion.service';
import { BarraCategoriasComponent } from '../../../shared/barra-categorias/barra-categorias.component';
import { agruparPorCategoria, mejorCoincidencia } from '../../../../core/utils/categorias';
import { enfocar, focoOcupado, FondoModalDirective, pantallaTactil } from '../../../../core/directives/fondo-modal.directive';

/** Consumo de una persona (por su celular) o lo cargado por el cajero (clave null) */
export interface GrupoCuenta {
  clave: string | null;
  nombre: string;
  items: any[];
  pendiente: number;
  pagado: number;
}

const centavos = (n: any) => Math.round(Number(n || 0) * 100);

/** Total de lo que falta cobrar */
const totalPendiente = (items: any[]) =>
  items.filter(i => !i.pagado).reduce((s, i) => s + centavos(i.subtotal), 0) / 100;

@Component({
  selector: 'app-mesa-modal',
  standalone: true,
  imports: [FondoModalDirective, CommonModule, NgTemplateOutlet, FormsModule, ImagenUrlPipe, TicketComponent, LucideAngularModule,
            BarraCategoriasComponent],
  templateUrl: './mesa-modal.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css', './mesa-modal.component.css']
})
export class MesaModalComponent implements OnInit, OnDestroy {
  private readonly sesion = inject(SesionService);
  @Input()  mesa:             any = null;
  @Output() cerrado           = new EventEmitter<void>();
  @Output() mesaActualizada   = new EventEmitter<void>();

  private cuentaService = inject(CuentaService);
  private dialogo = inject(DialogoService);
  private socketService = inject(SocketService);
  readonly ajustes       = inject(AjustesService);
  private impresion = inject(ImpresionService);
  private promociones = inject(PromocionService);
  readonly moneda        = this.ajustes.moneda;
  readonly cifra         = cifra;

  readonly icons = {
    cerrar: X, buscar: Search, quitar: Trash2, carrito: ShoppingCart, efectivo: Banknote,
    qr: QrCode, check: Check, imprimir: Printer, descargar: Download, cliente: User, descuento: BadgePercent,
    menos: Minus, mas: Plus
  };

  readonly esAdmin = this.sesion.esAdmin;
  readonly cargando     = signal(false);
  readonly cuentaActiva = signal<any>(null);
  readonly vista        = signal<'info' | 'comanda' | 'pago' | 'qr' | 'ticket'>('info');

  readonly productos       = signal<any[]>([]);
  readonly busqueda        = signal('');

  readonly metodo = METODO_PAGO;
  readonly metodoPago  = signal<MetodoPago>(METODO_PAGO.efectivo);
  readonly montoPagado = signal<number | null>(null);
  /** Monto recibido como número (vacío = 0) */
  readonly pagado      = computed(() => Number(this.montoPagado()) || 0);
  @ViewChild('inputMontoMesa') inputMontoMesaRef?: ElementRef<HTMLInputElement>;
  @ViewChild('buscador') buscadorRef?: ElementRef<HTMLInputElement>;
  @ViewChild('fondoMesa') fondoMesaRef?: ElementRef<HTMLElement>;
  private readonly injector = inject(Injector);
  @ViewChild('zonaTicket') zonaTicket?: ElementRef<HTMLElement>;

  /** A precio de lista */
  readonly brutoCuenta = computed(() => Number(this.cuentaActiva()?.total_acumulado || 0));

  // ─── Promociones: lo pendiente se cotiza en el backend cada vez que cambia la cuenta ───
  readonly cotizacionCuenta = signal<Cotizacion | null>(null);
  readonly totalCuenta = computed(() => this.cotizacionCuenta()?.total ?? this.brutoCuenta());
  private readonly claveCuenta = computed(() => {
    const c = this.cuentaActiva();
    return c ? JSON.stringify([c.id_cuenta, (c.items || []).map((i: any) => [i.id_detalle_cuenta, i.cantidad, !!i.pagado])]) : '';
  });
  private esperaCotizacion: any;

  /** Lo que se cobra en este momento (toda la cuenta o la parte de una persona) */
  readonly cotizacionPago = signal<Cotizacion | null>(null);

  // ─── Descuento manual al cobrar ───
  readonly descuento          = signal<DescuentoManual | null>(null);
  readonly editandoDescuento  = signal(false);
  readonly formDescuento      = signal<FormDescuento>({ tipo: 'PORCENTAJE', valor: null, motivo: '' });
  readonly errorDescuento     = signal('');
  readonly aplicandoDescuento = signal(false);

  // ─── Cobro por separado ───
  /** null = cobrar todo lo pendiente */
  readonly parteCobro = signal<GrupoCuenta | null>(null);

  readonly totalCobro = computed(() => this.cotizacionPago()?.total ?? this.parteCobro()?.pendiente ?? this.totalCuenta());
  readonly cambio     = computed(() => Math.max(0, this.pagado() - this.totalCobro()));

  readonly itemsPendientes = computed<any[]>(() => (this.cuentaActiva()?.items || []).filter((i: any) => !i.pagado));

  /** Agrupa por celular; los clientes sin nombre se numeran en orden de llegada */
  readonly grupos = computed(() => {
    const mapa = new Map<string | null, GrupoCuenta>();
    let numero = 0;
    for (const item of this.cuentaActiva()?.items || []) {
      const clave = item.cliente_mesa ?? null;
      let g = mapa.get(clave);
      if (!g) {
        g = { clave, nombre: clave ? `Cliente ${++numero}` : 'Cargado por el cajero', items: [], pendiente: 0, pagado: 0 };
        mapa.set(clave, g);
      }
      if (clave && item.nombre_cliente) g.nombre = item.nombre_cliente;
      g.items.push(item);
      if (item.pagado) g.pagado = (centavos(g.pagado) + centavos(item.subtotal)) / 100;
      else g.pendiente = (centavos(g.pendiente) + centavos(item.subtotal)) / 100;
    }
    // Lo del cajero al final
    return [...mapa.values()].sort((a, b) => Number(a.clave === null) - Number(b.clave === null));
  });

  /** Se agrupa cuando algún producto vino del celular de un cliente */
  readonly porCliente = computed(() => (this.cuentaActiva()?.items || []).some((i: any) => i.cliente_mesa));

  readonly productosFiltrados = computed(() => {
    const texto = this.busqueda().toLowerCase();
    return this.productos().filter(p => Number(p.stock_actual) > 0 && (!texto || p.nombre_producto.toLowerCase().includes(texto)));
  });

  /** Por categoría en el orden del menú; los que se agotan pasan al final */
  readonly secciones = computed(() => agruparPorCategoria(this.productosFiltrados()));
  /** El que se agrega con Enter al buscar */
  readonly primero = computed(() => mejorCoincidencia(this.secciones(), this.busqueda()));
  readonly barra = computed(() => this.secciones().map(s => ({ id: s.id, nombre: s.nombre, icono: s.icono, cantidad: s.productos.length })));

  readonly datosTicket = signal<any>(null);
  readonly fechaTicket = signal(new Date());

  readonly qrData = signal<any>(null);

  readonly notaProducto = signal('');

  /** false tras cobrar solo una parte: la mesa sigue abierta */
  readonly cuentaCerrada = signal(true);

  private subs: Subscription[] = [];
  private esperaRecarga: any;
  /** Un cambio de cantidad a la vez */
  readonly guardandoCantidad = signal(false);

  constructor() {
    effect(() => {
      const clave = this.claveCuenta();
      untracked(() => this.cotizarCuenta(clave));
    });
  }

  private cotizarCuenta(clave: string) {
    clearTimeout(this.esperaCotizacion);
    const cuenta = this.cuentaActiva();
    if (!clave || !cuenta || !this.itemsPendientes().length) return this.cotizacionCuenta.set(null);
    this.esperaCotizacion = setTimeout(() =>
      this.promociones.cotizarCuenta(cuenta.id_cuenta).subscribe({
        next: (c) => { if (this.claveCuenta() === clave) this.cotizacionCuenta.set(c); },
        error: () => this.cotizacionCuenta.set(null)
      }), 150);
  }

  // Con el consumo a la vista, el cursor queda en el buscador
  private readonly enfocarBuscador = effect(() => {
    if (this.vista() !== 'comanda' || this.cargando() || pantallaTactil()) return;
    afterNextRender(() => {
      if (!focoOcupado(this.fondoMesaRef?.nativeElement)) enfocar(this.buscadorRef?.nativeElement);
    }, { injector: this.injector });
  });

  // ─── Teclado: escribir + Enter agrega el marcado; Enter con el buscador vacío va a cobrar ───
  enterBuscador(evento: Event) {
    evento.preventDefault();
    const producto = this.primero();
    if (producto) {
      this.agregarProducto(producto);
      this.buscadorRef?.nativeElement.select();
    } else if (!this.busqueda().trim() && this.itemsPendientes().length) {
      this.irAPago();
    }
  }

  limpiarBusqueda(evento: Event) {
    if (!this.busqueda()) return;
    evento.stopPropagation();
    this.busqueda.set('');
  }

  /** Efectivo: cursor en el monto; QR: en «Confirmar» (Enter cobra) */
  elegirMetodo(metodo: MetodoPago) {
    this.metodoPago.set(metodo);
    afterNextRender(() => enfocar(metodo === METODO_PAGO.efectivo
      ? this.inputMontoMesaRef?.nativeElement
      : this.fondoMesaRef?.nativeElement.querySelector<HTMLElement>('.ventana .ventana [data-enter]')), { injector: this.injector });
  }

  ngOnInit() {
    this.cargarEstadoMesa();
    this.cargarProductos();
    this.escucharSocket();
  }

  ngOnDestroy() {
    clearTimeout(this.esperaCotizacion);
    clearTimeout(this.esperaRecarga);
    this.subs.forEach(s => s.unsubscribe());
  }

  private escucharSocket() {
    this.subs.push(this.socketService.escuchar<any>('cuenta:qr_integrado').subscribe(data => {
      if (this.cuentaActiva() && data.id_mesa === this.mesa?.id_mesa && data.items)
        this.cuentaActiva.update(c => ({ ...c, items: data.items, total_acumulado: data.total_acumulado }));
    }));

    this.subs.push(this.socketService.escuchar<any>('actualizacion_stock_global').subscribe(payload => {
      if (!payload || Number(payload.id_sucursal) !== (Number(this.mesa?.id_sucursal) || 1)) return;
      this.fijarStock(Number(payload.id_producto), Number(payload.nueva_cantidad_disponible) || 0);
    }));

    // Productos nuevos, editados o desactivados
    this.subs.push(this.socketService.escuchar<any>('catalogo:actualizado').subscribe(() => this.recargarProductos()));
  }

  private fijarStock(id_producto: number, stock: number) {
    if (!this.productos().some(p => Number(p.id_producto) === id_producto)) return this.recargarProductos();
    this.productos.update(ps => ps.map(p => Number(p.id_producto) === id_producto ? { ...p, stock_actual: stock } : p));
  }

  private recargarProductos() {
    clearTimeout(this.esperaRecarga);
    this.esperaRecarga = setTimeout(() => this.cargarProductos(), 400);
  }

  cargarEstadoMesa() {
    this.cargando.set(true);
    this.cuentaService.getCuentaActiva(this.mesa.id_mesa).subscribe({
      next: (res) => {
        this.cuentaActiva.set(res.cuenta);
        if (res.cuenta) {
          this.vista.set('comanda');
          this.cargando.set(false);
        } else {
          this.abrirMesa();
        }
      },
      error: () => this.cargando.set(false)
    });
  }

  async forzarReset() {
    if (!this.esAdmin()) { this.dialogo.error('Solo el administrador puede resetear una mesa.'); return; }
    const si = await this.dialogo.confirmar({
      titulo: `¿Resetear la Mesa ${this.mesa.numero_mesa}?`,
      mensaje: 'Se cancela la cuenta actual, el stock reservado vuelve al inventario y la mesa queda libre.',
      textoConfirmar: 'Resetear', peligro: true
    });
    if (!si) return;

    this.cargando.set(true);
    this.cuentaService.resetMesa(this.mesa.id_mesa).subscribe({
      next: () => {
        this.cargando.set(false);
        this.mesaActualizada.emit();
        this.cerrarModal();
      },
      error: (e: any) => { this.cargando.set(false); this.dialogo.error(e?.error?.error || 'No se pudo resetear la mesa.'); }
    });
  }

  cargarProductos() {
    const id_sucursal = Number(this.mesa?.id_sucursal) || 1;

    this.cuentaService.getProductos(id_sucursal).subscribe({
      next: (prods: any[]) => {
        this.productos.set(prods.map(p => ({ ...p, stock_actual: Number(p.stock_actual) || 0 })));
      },
      error: () => {
        console.error('Error al cargar catálogo de la mesa');
      }
    });
  }

  abrirMesa() {
    this.cargando.set(true);
    this.cuentaService.abrirCuenta(this.mesa.id_mesa).subscribe({
      next: (res) => {
        this.cuentaActiva.set({ ...res.cuenta, items: [], total_acumulado: 0 });
        this.vista.set('comanda');
        this.cargando.set(false);
        this.mesaActualizada.emit();
      },
      error: (e: any) => {
        this.dialogo.error(e?.error?.error || 'No se pudo abrir la mesa.');
        this.cargando.set(false);
      }
    });
  }

  agregarProducto(producto: any) {
    const cuenta = this.cuentaActiva();
    if (!cuenta) return;

    const stockDisponible = Number(producto.stock_actual) || 0;
    if (stockDisponible <= 0) {
      this.dialogo.error(`Sin stock: ${producto.nombre_producto}`);
      return;
    }

    const precio = Number(producto.precio_unitario);
    const nota   = this.notaProducto() || undefined;

    this.cuentaService.agregarProducto(cuenta.id_cuenta, {
      id_producto:     producto.id_producto,
      cantidad:        1,
      precio_unitario: precio,
      nota
    }).subscribe({
      next: (res: any) => {
        this.cuentaActiva.update(c => {
          const items = [...(c.items || [])];
          const i = items.findIndex((x: any) =>
            x.id_producto === producto.id_producto && x.origen === 'cajero' && !x.pagado && !x.cliente_mesa);
          if (i >= 0) {
            const cantidad = items[i].cantidad + 1;
            items[i] = { ...items[i], cantidad, subtotal: cantidad * precio };
          } else {
            items.push({
              id_detalle_cuenta: res.detalle?.id_detalle_cuenta,
              id_producto:       producto.id_producto,
              nombre_producto:   producto.nombre_producto,
              url_imagen:        producto.url_imagen,
              precio_unitario:   precio,
              cantidad:          1,
              subtotal:          precio,
              nota:              nota || null,
              origen:            'cajero'
            });
          }
          return { ...c, items, total_acumulado: res.total ?? totalPendiente(items) };
        });
        this.fijarStock(Number(producto.id_producto), res.stock ?? stockDisponible - 1);
        this.notaProducto.set('');
      },
      error: (e: any) => this.dialogo.error(e?.error?.error || 'No se pudo agregar el producto.')
    });
  }

  quitarProducto(id_detalle: number) {
    const itemQuitado = this.cuentaActiva()?.items?.find((i: any) => i.id_detalle_cuenta === id_detalle);

    this.cuentaService.quitarProducto(id_detalle).subscribe({
      next: (res: any) => {
        this.cuentaActiva.update(c => {
          const items = c.items.filter((i: any) => i.id_detalle_cuenta !== id_detalle);
          return { ...c, items, total_acumulado: res.total ?? totalPendiente(items) };
        });
        if (itemQuitado) {
          const prod = this.productos().find(p => p.id_producto === itemQuitado.id_producto);
          if (prod) this.fijarStock(Number(prod.id_producto), res.stock ?? Number(prod.stock_actual) + Number(itemQuitado.cantidad || 1));
        }
      },
      error: (e: any) => this.dialogo.error(e?.error?.error || 'No se pudo quitar el producto.')
    });
  }

  /** Cantidad escrita o con −/+ (el backend reserva o devuelve la diferencia de stock) */
  fijarCantidad(item: any, valor: any, campo?: HTMLInputElement) {
    let cantidad = Math.floor(Number(valor));
    if (!(cantidad >= 1) || cantidad === item.cantidad || this.guardandoCantidad()) {
      if (campo) campo.value = String(item.cantidad);
      return;
    }
    this.guardandoCantidad.set(true);
    this.cuentaService.cambiarCantidad(item.id_detalle_cuenta, cantidad).subscribe({
      next: (res: any) => {
        this.guardandoCantidad.set(false);
        this.cuentaActiva.update(c => {
          const items = (c.items || []).map((i: any) => i.id_detalle_cuenta === item.id_detalle_cuenta
            ? { ...i, cantidad, subtotal: cantidad * Number(i.precio_unitario) } : i);
          return { ...c, items, total_acumulado: res.total ?? totalPendiente(items) };
        });
        if (res.stock != null) this.fijarStock(Number(item.id_producto), Number(res.stock));
      },
      error: (e: any) => {
        this.guardandoCantidad.set(false);
        if (campo) campo.value = String(item.cantidad);
        this.dialogo.error(e?.error?.error || 'No se pudo cambiar la cantidad.');
      }
    });
  }

  /** Enter en la cantidad: vuelve al buscador */
  volverAlBuscador(evento: Event) {
    evento.preventDefault();
    evento.stopPropagation();
    (evento.target as HTMLInputElement).blur();
    if (!pantallaTactil()) this.buscadorRef?.nativeElement.focus();
  }

  irAPago(parte: GrupoCuenta | null = null) {
    this.parteCobro.set(parte);
    this.cotizacionPago.set(null);
    this.descuento.set(null);
    this.editandoDescuento.set(false);
    this.promociones.cotizarCuenta(this.cuentaActiva().id_cuenta, parte ? parte.clave : undefined).subscribe({
      next: (c) => { if (this.parteCobro() === parte) this.cotizacionPago.set(c); },
      error: (e) => this.dialogo.error(e?.error?.detalle || e?.error?.error || 'No se pudo calcular el total.')
    });
    this.montoPagado.set(null);
    this.metodoPago.set(this.ajustes.config().pago_efectivo ? METODO_PAGO.efectivo : METODO_PAGO.qr);
    this.vista.set('pago');
  }

  abrirDescuento() {
    this.formDescuento.set({ tipo: 'PORCENTAJE', valor: null, motivo: '' });
    this.errorDescuento.set('');
    this.editandoDescuento.set(true);
  }

  /** Se valida con el backend (tope del cajero, total) antes de aplicarlo */
  aplicarDescuento(form: FormDescuento | null) {
    const d: DescuentoManual | null = form && { ...form, valor: Number(form.valor) || 0 };
    if (d) {
      if (!(d.valor > 0)) return this.errorDescuento.set('Indica el descuento.');
      if (d.motivo.trim().length < 3) return this.errorDescuento.set('Indica el motivo del descuento.');
    }
    const parte = this.parteCobro();
    this.aplicandoDescuento.set(true);
    this.promociones.cotizarCuenta(this.cuentaActiva().id_cuenta, parte ? parte.clave : undefined, d).subscribe({
      next: (c) => {
        this.aplicandoDescuento.set(false);
        this.descuento.set(d);
        this.cotizacionPago.set(c);
        this.editandoDescuento.set(false);
      },
      error: (e) => {
        this.aplicandoDescuento.set(false);
        this.errorDescuento.set(e?.error?.detalle || e?.error?.error || 'No se pudo aplicar el descuento.');
      }
    });
  }

  confirmarPago() {
    const totalReq = this.totalCobro();
    const metodo = this.metodoPago();
    if (metodo === METODO_PAGO.efectivo && this.pagado() < totalReq) {
      this.montoPagado.set(totalReq);
    }

    const parte = this.parteCobro();
    this.cargando.set(true);
    this.cuentaService.cerrarCuenta(this.cuentaActiva().id_cuenta, metodo, parte ? parte.clave : undefined, this.descuento()).subscribe({
      next: (res: any) => {
        this.cuentaCerrada.set(res.cuenta_cerrada !== false);
        const cot: Cotizacion | undefined = res.cotizacion;
        const nombres = new Map<number, string>((this.cuentaActiva()?.items || []).map((i: any) => [i.id_producto, i.nombre_producto]));
        this.datosTicket.set({
          id_venta:     res.id_venta,
          numero_mesa:  this.mesa.numero_mesa,
          cliente:      parte?.clave ? parte.nombre : undefined,
          items:        cot
            ? cot.items.map(l => ({ nombre_producto: nombres.get(l.id_producto) || '', cantidad: l.cantidad,
                                    precio_unitario: l.precio_unitario, subtotal: l.subtotal_bruto,
                                    descuento: l.descuento_promocion, promocion: l.promociones.join(', ') }))
            : (parte ? parte.items.filter(i => !i.pagado) : this.itemsPendientes()),
          total:        res.total ?? totalReq,
          descuento_promociones: cot?.descuento_promociones || 0,
          descuento_manual:      cot?.descuento_manual || 0,
          motivo_descuento:      this.descuento()?.motivo ?? null,
          metodo,
          cambio:       this.cambio()
        });
        this.fechaTicket.set(new Date());
        this.cargando.set(false);
        this.vista.set('ticket');
        this.mesaActualizada.emit();
      },
      error: (e: any) => {
        this.dialogo.error(e?.error?.detalle || e?.error?.error || 'No se pudo cerrar la cuenta.');
        this.cargando.set(false);
      }
    });
  }

  verQR() {
    this.vista.set('qr');
    if (!this.qrData()) {
      this.cuentaService.getQR(this.mesa.id_mesa).subscribe({
        next: (data) => this.qrData.set(data)
      });
    }
  }

  descargarQR() {
    const qr = this.qrData();
    if (!qr) return;
    const a = document.createElement('a');
    a.href     = qr.qr;
    a.download = `QR_Mesa_${this.mesa.numero_mesa}.png`;
    a.click();
  }

  /** Después del comprobante de una parte se vuelve al consumo de la mesa */
  cerrarTicket() {
    if (this.cuentaCerrada()) { this.cerrarModal(); return; }
    this.datosTicket.set(null);
    this.parteCobro.set(null);
    this.vista.set('comanda');
    this.cargarEstadoMesa();
  }

  /** Imprime y sigue: vuelve a la mesa o la cierra si ya no queda nada */
  imprimirTicket() {
    this.impresion.imprimirTicket(this.zonaTicket?.nativeElement, this.ajustes.config().ticket_ancho);
    this.cerrarTicket();
  }

  cerrarModal() {
    const cuenta = this.cuentaActiva();
    const cuentaSinItems = cuenta && this.itemsPendientes().length === 0 && this.vista() !== 'ticket';
    if (cuentaSinItems) {
      this.cuentaService.cancelarSiVacia(cuenta.id_cuenta).subscribe({
        next: () => { this.mesaActualizada.emit(); this.cerrado.emit(); },
        error: () => this.cerrado.emit()
      });
      return;
    }
    this.cerrado.emit();
  }
}
