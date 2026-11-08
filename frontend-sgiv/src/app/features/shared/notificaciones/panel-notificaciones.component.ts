import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, X, PackageMinus, PackageX, Scale, Clock, ArrowLeftRight, BadgePercent, CheckCheck, Bell,
         CalendarClock, CalendarX } from 'lucide-angular';
import { FondoModalDirective } from '../../../core/directives/fondo-modal.directive';
import { Notificacion, NotificacionService, TipoNotificacion } from '../../../core/services/notificacion.service';

const ICONOS: Record<TipoNotificacion, any> = {
  STOCK_BAJO: PackageMinus, AGOTADO: PackageX, ARQUEO: Scale,
  CAJA_SIN_CERRAR: Clock, TRANSFERENCIA: ArrowLeftRight, DESCUENTO: BadgePercent,
  POR_VENCER: CalendarClock, VENCIDO: CalendarX
};

// ─── Panel de la campana: últimas notificaciones; cada una lleva a su pantalla ───
@Component({
  selector: 'app-panel-notificaciones',
  standalone: true,
  imports: [LucideAngularModule, FondoModalDirective],
  templateUrl: './panel-notificaciones.component.html',
  styleUrl: './panel-notificaciones.component.css'
})
export class PanelNotificacionesComponent {
  private readonly router = inject(Router);
  readonly servicio = inject(NotificacionService);

  /** Pantallas a las que el usuario puede entrar (las demás no son enlace) */
  readonly rutas  = input<Set<string>>(new Set());
  readonly cerrar = output<void>();

  readonly soloNoLeidas = signal(this.servicio.noLeidas() > 0);
  readonly visibles = computed(() => this.servicio.lista().filter(n => !this.soloNoLeidas() || !n.leida));
  readonly icons = { x: X, todas: CheckCheck, vacio: Bell };

  icono(n: Notificacion) { return ICONOS[n.tipo] ?? Bell; }

  puedeIr(n: Notificacion) { return !!n.ruta && this.rutas().has(n.ruta); }

  abrir(n: Notificacion) {
    if (!n.leida) this.servicio.marcarLeidas([n.id_notificacion]);
    if (!this.puedeIr(n)) return;
    this.cerrar.emit();
    this.router.navigate(['/dashboard', n.ruta]);
  }

  hace(fecha: string): string {
    const d = new Date(fecha);
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `Hace ${horas} h`;
    return d.toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}
