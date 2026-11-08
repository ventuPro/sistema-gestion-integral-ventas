import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { LucideAngularModule, X, CalendarX } from 'lucide-angular';
import { InventarioService, LoteVencimiento } from '../../../../core/services/inventario.service';
import { SocketService } from '../../../../core/services/socket.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

// ─── Inventario → «Vencidos»: lotes vencidos (para dar de baja) y por vencer ───
// Un vencido no se bloquea en la venta: aquí se decide qué se retira.
@Component({
  selector: 'app-vencidos',
  standalone: true,
  imports: [FondoModalDirective, DatePipe, LucideAngularModule],
  templateUrl: './vencidos.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/formulario/formulario.css']
})
export class VencidosComponent implements OnInit, OnDestroy {
  private inventario = inject(InventarioService);
  private socket     = inject(SocketService);
  private dialogo    = inject(DialogoService);

  readonly idSucursal     = input.required<number>();
  readonly nombreSucursal = input('');
  readonly cerrar         = output<void>();

  readonly icons = { cerrar: X, baja: CalendarX };

  readonly lotes    = signal<LoteVencimiento[]>([]);
  readonly estado   = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly quitados = signal<Set<number>>(new Set());
  readonly guardando = signal(false);
  private sub?: Subscription;
  private recarga?: ReturnType<typeof setTimeout>;

  readonly vencidos  = computed(() => this.lotes().filter(l => l.estado === 'VENCIDO'));
  readonly porVencer = computed(() => this.lotes().filter(l => l.estado === 'POR_VENCER'));
  readonly elegidos  = computed(() => this.vencidos().filter(l => !this.quitados().has(l.id_lote)));
  readonly unidades  = computed(() => this.elegidos().reduce((s, l) => s + l.cantidad, 0));
  readonly todos     = computed(() => this.vencidos().length > 0 && this.elegidos().length === this.vencidos().length);

  ngOnInit() {
    this.cargar();
    this.socket.conectar('cajeros');
    // Una venta o merma cambia lo que queda en los lotes
    this.sub = this.socket.escuchar<any>('actualizacion_stock_global').subscribe(p => {
      if (Number(p?.id_sucursal) !== this.idSucursal()) return;
      clearTimeout(this.recarga);
      this.recarga = setTimeout(() => this.cargar(), 500);
    });
    this.sub.add(this.socket.reconexiones.subscribe(() => this.cargar()));
  }

  ngOnDestroy() { this.sub?.unsubscribe(); clearTimeout(this.recarga); }

  cargar() {
    this.inventario.vencimientos(this.idSucursal()).subscribe({
      next:  (l) => { this.lotes.set(l); this.estado.set('listo'); },
      error: () => this.estado.set('error')
    });
  }

  alternar(id_lote: number) {
    this.quitados.update(s => {
      const n = new Set(s);
      if (n.has(id_lote)) n.delete(id_lote); else n.add(id_lote);
      return n;
    });
  }

  alternarTodos() {
    this.quitados.set(this.todos() ? new Set(this.vencidos().map(l => l.id_lote)) : new Set());
  }

  async darDeBaja() {
    const lotes = this.elegidos();
    if (!lotes.length || this.guardando()) return;
    const unidades = this.unidades();
    if (!(await this.dialogo.confirmar({
      titulo: `¿Dar de baja ${unidades} ${unidades === 1 ? 'unidad vencida' : 'unidades vencidas'}?`,
      mensaje: 'Salen del stock como merma «Vencido».', textoConfirmar: 'Dar de baja', peligro: true
    }))) return;
    this.guardando.set(true);
    this.inventario.darDeBajaVencidos(this.idSucursal(), lotes.map(l => l.id_lote)).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.quitados.set(new Set());
        this.dialogo.avisar(r.unidades ? `${r.unidades} ${r.unidades === 1 ? 'unidad dada' : 'unidades dadas'} de baja` : 'Ya no quedaban vencidos');
        this.cargar();
      },
      error: (e) => { this.guardando.set(false); this.dialogo.error(e?.error?.error || 'No se pudieron dar de baja.'); }
    });
  }
}
