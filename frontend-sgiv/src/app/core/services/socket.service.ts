import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';  // ← 3 niveles, no 4

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private readonly URL = environment.apiUrl.replace('/api', '');

  conectar(sala: string) {
    if (this.socket?.connected) return;
    this.socket = io(this.URL, { transports: ['websocket'] });
    this.socket.on('connect', () => {
      this.socket?.emit('unirse_sala', sala);
    });
  }

  desconectar() {
    this.socket?.disconnect();
    this.socket = null;
  }

  escuchar<T>(evento: string): Observable<T> {
    return new Observable(observer => {
      this.socket?.on(evento, (data: T) => observer.next(data));
    });
  }

  emitir(evento: string, data: any) {
    this.socket?.emit(evento, data);
  }

  get conectado(): boolean {
    return this.socket?.connected ?? false;
  }
}