import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
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
export class CierresCajaComponent implements OnInit {
  private cajaService     = inject(CajaService);
  private sucursalService = inject(SucursalService);
  private cdr             = inject(ChangeDetectorRef);
  readonly moneda         = inject(AjustesService).moneda;

  readonly icons = { actualizar: RotateCw };
  readonly cifra = cifra;
  readonly entero = entero;
  readonly fechaHora = fechaHora;
  readonly hora = hora;

  cierres:          any[] = [];
  cierresFiltrados: any[] = [];
  sucursales:       any[] = [];
  sucursalFiltro:   any   = null;  // null = todas
  cargando          = true;

  ngOnInit() {
    this.sucursalService.listarSucursales().subscribe({
      next: (s: any[]) => { this.sucursales = s || []; this.cdr.detectChanges(); }
    });
    this.cargar();
  }

  cargar() {
    this.cargando = !this.cierres.length;
    this.cajaService.obtenerCierres().subscribe({
      next: (data) => { this.cierres = data || []; this.aplicarFiltro(); this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cambiarSucursal(id: number | null) {
    this.sucursalFiltro = this.sucursales.find(s => s.id_sucursal === id) || null;
    this.aplicarFiltro();
  }

  aplicarFiltro() {
    this.cierresFiltrados = this.sucursalFiltro
      ? this.cierres.filter(c => c.id_sucursal === this.sucursalFiltro.id_sucursal)
      : [...this.cierres];
    this.cdr.detectChanges();
  }

  mismoDia(c: any): boolean {
    return new Date(c.fecha_hora_apertura).toDateString() === new Date(c.fecha_hora_cierre).toDateString();
  }

  get totales() {
    const t = { ventas: 0, total: 0, efectivo: 0, qr: 0, diferencia: 0, contados: 0 };
    for (const c of this.cierresFiltrados) {
      t.ventas   += Number(c.total_ventas);
      t.total    += Number(c.total_recaudado);
      t.efectivo += Number(c.total_efectivo);
      t.qr       += Number(c.total_qr);
      if (c.diferencia !== null) { t.diferencia += Number(c.diferencia); t.contados++; }
    }
    return t;
  }
}
