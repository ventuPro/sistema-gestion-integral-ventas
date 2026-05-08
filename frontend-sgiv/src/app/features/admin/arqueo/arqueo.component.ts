import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CajaService } from '../../../core/services/caja.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-arqueo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './arqueo.component.html',
  styleUrl: './arqueo.component.css'
})
export class ArqueoComponent implements OnInit {
  private cajaService = inject(CajaService);
  private cdr         = inject(ChangeDetectorRef);
  private router      = inject(Router);

  cargando      = true;
  cerrando      = false;
  mostrarConfirmCierre = false;

  usuarioActual: any = null;
  esAdmin        = false;

  arqueo: any = {
    resumen:      { total_ventas: 0, ingresos_totales: 0, total_efectivo: 0, total_qr: 0 },
    ventas:       [],
    turno_activo: null
  };

  hoy = new Date();

  ngOnInit() {
    const raw = localStorage.getItem('usuario_sgiv');
    this.usuarioActual = raw ? JSON.parse(raw) : null;
    this.esAdmin       = this.usuarioActual?.id_rol === 1;
    this.cargarArqueo();
  }

  cargarArqueo() {
    this.cargando = true;
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;

    this.cajaService.obtenerArqueo(id_sucursal).subscribe({
      next: (data) => {
        this.arqueo  = data;
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (e) => {
        console.error('Error al cargar arqueo:', e);
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  confirmarCierre() {
    this.mostrarConfirmCierre = true;
  }

  cancelarCierre() {
    this.mostrarConfirmCierre = false;
  }

  ejecutarCierreCaja() {
    this.cerrando = true;
    const id_sucursal = this.usuarioActual?.id_sucursal || 1;

    this.cajaService.cerrarCaja({ id_sucursal }).subscribe({
      next: () => {
        this.cerrando = false;
        this.mostrarConfirmCierre = false;
        // Actualizar localStorage para reflejar caja cerrada
        if (this.usuarioActual) {
          this.usuarioActual.caja_habilitada = false;
          localStorage.setItem('usuario_sgiv', JSON.stringify(this.usuarioActual));
        }
        this.cdr.detectChanges();
        // Redirigir al dashboard después de cerrar
        setTimeout(() => this.router.navigate(['/dashboard']), 1500);
      },
      error: () => {
        this.cerrando = false;
        alert('Error al cerrar la caja.');
        this.cdr.detectChanges();
      }
    });
  }
}