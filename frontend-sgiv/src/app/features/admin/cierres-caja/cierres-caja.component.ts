import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CajaService } from '../../../core/services/caja.service';

@Component({
  selector: 'app-cierres-caja',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cierres-caja.component.html'
})
export class CierresCajaComponent implements OnInit {
  private cajaService = inject(CajaService);
  private cdr         = inject(ChangeDetectorRef);

  cierres:  any[] = [];
  cargando  = true;

  ngOnInit() { this.cargar(); }

  cargar() {
    this.cargando = true;
    this.cajaService.obtenerCierres().subscribe({
      next: (data) => { this.cierres = data; this.cargando = false; this.cdr.detectChanges(); },
      error: ()    => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  getTotalGeneral(): number {
    return this.cierres.reduce((s, c) => s + (+c.total_recaudado), 0);
  }
}