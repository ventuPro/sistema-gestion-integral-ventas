import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ─── Socket compartido del personal; solo se desconecta al cerrar sesión ───
@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private salas = new Set<string>();
  private readonly URL = environment.apiUrl.replace('/api', '');

  private asegurarSocket(): Socket {
    if (!this.socket) {
      this.socket = io(this.URL, { transports: ['websocket'] });
      this.socket.on('connect', () => this.salas.forEach(s => this.unirse(s)));
    }
    return this.socket;
  }

  private unirse(sala: string) {
    this.socket?.emit('unirse_sala', sala, localStorage.getItem('token_sgiv'));
  }

  conectar(sala: string) {
    const socket = this.asegurarSocket();
    if (this.salas.has(sala)) return;
    this.salas.add(sala);
    if (socket.connected) this.unirse(sala);
  }

  desconectar() {
    this.socket?.disconnect();
    this.socket = null;
    this.salas.clear();
  }

  escuchar<T>(evento: string): Observable<T> {
    return new Observable<T>(observer => {
      const socket  = this.asegurarSocket();
      const handler = (data: T) => observer.next(data);
      socket.on(evento, handler);
      return () => socket.off(evento, handler);
    });
  }

  emitir(evento: string, data: any) {
    this.asegurarSocket().emit(evento, data);
  }

  get conectado(): boolean {
    return this.socket?.connected ?? false;
  }
}
