import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { SocketService } from '../../../core/services/socket.service';
import { CajaService } from '../../../core/services/caja.service';
import { SucursalService } from '../../../core/services/sucursal.service';
import { AjustesService } from '../../../core/services/ajustes.service';
import { SelectorSucursalComponent } from '../../shared/selector-sucursal/selector-sucursal.component';
import { cifra, entero, fechaHora, hora } from '../../../core/utils/informe';

@Component({
  selector: 'app-cierres-caja',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, SelectorSucursalComponent],
  templateUrl: './cierres-caja.component.html',
  styleUrls: ['../../shared/informe/informe.css']
})
export class CierresCajaComponent implements OnInit, OnDestroy {
  private cajaService     = inject(CajaService);
  private socket          = inject(SocketService);
  private sub?: Subscription;
  private sucursalService = inject(SucursalService);
  readonly moneda         = inject(AjustesService).moneda;

  readonly cifra = cifra;
  readonly entero = entero;
  readonly fechaHora = fechaHora;
  readonly hora = hora;

  readonly cierres        = signal<any[]>([]);
  readonly sucursales     = signal<any[]>([]);
  readonly sucursalFiltro = signal<any>(null);  // null = todas
  readonly cargando       = signal(true);

  readonly cierresFiltrados = computed(() => {
    const filtro = this.sucursalFiltro();
    return filtro ? this.cierres().filter(c => c.id_sucursal === filtro.id_sucursal) : this.cierres();
  });

  readonly totales = computed(() => {
    const t = { ventas: 0, total: 0, efectivo: 0, qr: 0 };
    for (const c of this.cierresFiltrados()) {
      t.ventas   += Number(c.total_ventas);
      t.total    += Number(c.total_recaudado);
      t.efectivo += Number(c.total_efectivo);
      t.qr       += Number(c.total_qr);
    }
    return t;
  });

  ngOnInit() {
    this.sucursalService.listarSucursales().subscribe({
      next: (s: any[]) => this.sucursales.set(s || [])
    });
    this.cargar();
    // Un cierre o una reapertura (cajero, administrador o sistema) se ve al instante
    this.socket.conectar('cajeros');
    this.sub = this.socket.escuchar<any>('cierres:actualizados').subscribe(() => this.cargar());
    this.sub.add(this.socket.reconexiones.subscribe(() => this.cargar()));
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  cargar() {
    this.cargando.set(!this.cierres().length);
    this.cajaService.obtenerCierres().subscribe({
      next: (data) => { this.cierres.set(data || []); this.cargando.set(false); },
      error: () => this.cargando.set(false)
    });
  }

  cambiarSucursal(id: number | null) {
    this.sucursalFiltro.set(this.sucursales().find(s => s.id_sucursal === id) || null);
  }

  mismoDia(c: any): boolean {
    return new Date(c.fecha_hora_apertura).toDateString() === new Date(c.fecha_hora_cierre).toDateString();
  }
}
