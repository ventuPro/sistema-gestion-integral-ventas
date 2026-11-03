import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SocketService } from './socket.service';
import { DialogoService } from './dialogo.service';

// ─── Notificaciones del usuario (campana del menú lateral) ───

export type TipoNotificacion = 'STOCK_BAJO' | 'AGOTADO' | 'ARQUEO' | 'CAJA_SIN_CERRAR' | 'TRANSFERENCIA' | 'DESCUENTO';

export interface Notificacion {
  id_notificacion: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  ruta: string | null;
  fecha_creacion: string;
  leida: boolean;
}

interface Respuesta { no_leidas: number; notificaciones: Notificacion[] }

// Las que además salen como aviso emergente al llegar (stock y descuentos solo suman al contador)
const EMERGENTES = new Set<TipoNotificacion>(['ARQUEO', 'CAJA_SIN_CERRAR', 'TRANSFERENCIA']);
const MAX_LISTA = 50;

@Injectable({ providedIn: 'root' })
export class NotificacionService {
  private readonly http    = inject(HttpClient);
  private readonly socket  = inject(SocketService);
  private readonly dialogo = inject(DialogoService);
  private readonly url     = `${environment.apiUrl}/notificaciones`;

  readonly lista    = signal<Notificacion[]>([]);
  readonly noLeidas = signal(0);
  private subs: Subscription[] = [];

  iniciar() {
    if (this.subs.length) return;
    this.cargar();
    this.subs = [
      this.socket.escuchar<Notificacion>('notificacion:nueva').subscribe(n => this.recibir(n)),
      this.socket.reconexiones.subscribe(() => this.cargar())
    ];
  }

  detener() {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.lista.set([]);
    this.noLeidas.set(0);
  }

  cargar() {
    this.http.get<Respuesta>(this.url).subscribe({ next: r => this.aplicar(r), error: () => {} });
  }

  /** ids: las indicadas; sin ids, todas */
  marcarLeidas(ids?: number[]) {
    const previa = this.lista();
    this.lista.update(l => l.map(n => !ids || ids.includes(n.id_notificacion) ? { ...n, leida: true } : n));
    this.noLeidas.update(c => ids ? Math.max(0, c - previa.filter(n => !n.leida && ids.includes(n.id_notificacion)).length) : 0);
    this.http.post<Respuesta>(`${this.url}/leidas`, ids ? { ids } : {}).subscribe({
      next: r => this.aplicar(r),
      error: () => this.cargar()
    });
  }

  private aplicar(r: Respuesta) {
    this.lista.set(r.notificaciones);
    this.noLeidas.set(r.no_leidas);
  }

  private recibir(n: Notificacion) {
    if (this.lista().some(x => x.id_notificacion === n.id_notificacion)) return;
    this.lista.update(l => [n, ...l].slice(0, MAX_LISTA));
    if (n.leida) return;
    this.noLeidas.update(c => c + 1);
    if (EMERGENTES.has(n.tipo)) this.dialogo.avisar(`${n.titulo}. ${n.mensaje}`);
  }
}
