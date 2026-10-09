import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom, tap, timeout } from 'rxjs';
import { io } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { ImagenUrlPipe } from '../pipes/imagen-url.pipe';

export type Tema = 'claro' | 'oscuro' | 'auto';

export interface Propietario {
  id_propietario?: number;
  nombre_completo: string;
  ci: string | null;
  cargo: string | null;
  telefono: string | null;
  correo: string | null;
  porcentaje_participacion: number | string;
}

export interface Configuracion {
  nombre_comercial: string;
  razon_social: string | null;
  nit: string | null;
  rubro: string | null;
  eslogan: string | null;
  telefono: string | null;
  whatsapp: string | null;
  correo: string | null;
  sitio_web: string | null;
  direccion: string | null;
  ciudad: string | null;
  pais: string | null;
  facebook: string | null;
  instagram: string | null;
  tiktok: string | null;
  url_logo: string | null;
  url_favicon: string | null;
  color_primario: string | null;
  color_secundario: string | null;
  tema: Tema;
  fecha_actualizacion?: string;
}

// Mismos valores por defecto que la tabla configuracion
export const CONFIG_ORIGINAL: Configuracion = {
  nombre_comercial: "Pastelería Ricky's", razon_social: null, nit: null, rubro: 'Pastelería',
  eslogan: null, telefono: null, whatsapp: null, correo: null, sitio_web: null, direccion: null,
  ciudad: 'La Paz', pais: 'Bolivia', facebook: null, instagram: null, tiktok: null,
  url_logo: null, url_favicon: null, color_primario: null, color_secundario: null, tema: 'claro'
};

// Tonos originales de Tailwind (blue-600 e indigo-600), para mostrar en el selector
export const COLOR_PRIMARIO_ORIGINAL   = '#155dfc';
export const COLOR_SECUNDARIO_ORIGINAL = '#4f39f6';

// Cada tono se obtiene mezclando el color elegido (tono 600) con blanco o negro
const TONOS: [number, string, number][] = [
  [50, 'white', 8], [100, 'white', 16], [200, 'white', 30], [300, 'white', 50], [400, 'white', 72],
  [500, 'white', 88], [600, '', 100], [700, 'black', 16], [800, 'black', 32], [900, 'black', 46], [950, 'black', 62]
];

const CLAVE_CACHE = 'ajustes_sgiv';

// ─── Configuración del negocio: nombre, logo, colores y tema ───
@Injectable({ providedIn: 'root' })
export class AjustesService {
  private http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/ajustes`;
  private readonly imagenUrl = new ImagenUrlPipe();
  private readonly consultaOscuro = window.matchMedia?.('(prefers-color-scheme: dark)');

  readonly config = signal<Configuracion>(this.leerCache() ?? CONFIG_ORIGINAL);

  readonly nombre = computed(() => this.config().nombre_comercial);
  readonly logo   = computed(() => this.imagenUrl.transform(this.config().url_logo));
  /** Modo oscuro aplicado ahora mismo en <html> */
  readonly oscuro = signal(false);

  private iniciado = false;

  /** Se llama al arrancar la app; si el backend no responde se usa la última copia. */
  async iniciar(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    try { localStorage.removeItem('tema_sgiv'); } catch { }   // preferencia de la versión anterior
    this.aplicar(this.config());
    this.consultaOscuro?.addEventListener('change', () => this.aplicarTema());

    io(environment.apiUrl.replace('/api', ''), { transports: ['websocket'] })
      .on('ajustes:actualizados', (c: Configuracion) => c && this.establecer(c));

    try {
      const c = await firstValueFrom(this.http.get<Configuracion>(`${this.api}/publico`).pipe(timeout(3000)));
      if (c) this.establecer(c);
    } catch { /* se queda con la copia local o los valores originales */ }
  }

  private h(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token_sgiv')}`);
  }

  obtenerCompleto(): Observable<Configuracion> {
    return this.http.get<Configuracion>(this.api, { headers: this.h() });
  }

  guardarEmpresa(datos: Partial<Configuracion>): Observable<any> {
    return this.http.put(`${this.api}/empresa`, datos, { headers: this.h() })
      .pipe(tap((r: any) => this.establecer(r.configuracion)));
  }

  /** logo/favicon: data URI para cambiarlo, null para quitarlo, sin enviar para dejarlo igual */
  guardarApariencia(datos: Partial<Configuracion> & { logo?: string | null; favicon?: string | null }): Observable<any> {
    return this.http.put(`${this.api}/apariencia`, datos, { headers: this.h() })
      .pipe(tap((r: any) => this.establecer(r.configuracion)));
  }

  // ─── Propietarios (solo administrador) ───
  listarPropietarios(): Observable<Propietario[]> {
    return this.http.get<Propietario[]>(`${this.api}/propietarios`, { headers: this.h() });
  }

  guardarPropietario(p: Propietario): Observable<any> {
    return p.id_propietario
      ? this.http.put(`${this.api}/propietarios/${p.id_propietario}`, p, { headers: this.h() })
      : this.http.post(`${this.api}/propietarios`, p, { headers: this.h() });
  }

  eliminarPropietario(id: number): Observable<any> {
    return this.http.delete(`${this.api}/propietarios/${id}`, { headers: this.h() });
  }

  /** Vista previa sin guardar (pantalla de Ajustes) */
  previsualizar(parcial: Partial<Configuracion>) {
    this.aplicar({ ...this.config(), ...parcial });
  }

  /** Quita la vista previa y vuelve a lo guardado */
  restaurarVista() {
    this.aplicar(this.config());
  }

  /** Color principal efectivo en RGB, para PDF y ventanas de impresión */
  colorPrimarioRgb(): [number, number, number] {
    const hex = this.config().color_primario || '#2563eb';
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  }

  /** Logo como data URI (para incrustarlo en el PDF); null si no hay o falla */
  async logoComoDataUri(): Promise<string | null> {
    const url = this.logo();
    if (!url) return null;
    try {
      const blob = await (await fetch(url)).blob();
      return await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => res(null);
        r.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  private establecer(c: Configuracion) {
    this.config.set({ ...CONFIG_ORIGINAL, ...c });
    try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(this.config())); } catch { }
    this.aplicar(this.config());
  }

  private aplicar(c: Configuracion) {
    this.aplicarPaleta('blue',   c.color_primario);
    this.aplicarPaleta('indigo', c.color_secundario);
    this.aplicarTema(c.tema);
    document.title = c.nombre_comercial;
    const icono = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icono) icono.href = c.url_favicon ? this.imagenUrl.transform(c.url_favicon) : 'favicon.ico';
  }

  // Tailwind usa variables --color-<familia>-<tono>: se reemplazan en <html>
  private aplicarPaleta(familia: string, hex: string | null) {
    const estilo = document.documentElement.style;
    for (const [tono, base, porcentaje] of TONOS) {
      const variable = `--color-${familia}-${tono}`;
      if (!hex) estilo.removeProperty(variable);
      else estilo.setProperty(variable, base ? `color-mix(in oklab, ${hex} ${porcentaje}%, ${base})` : hex);
    }
  }

  private aplicarTema(tema: Tema = this.config().tema) {
    const oscuro = tema === 'oscuro' || (tema === 'auto' && !!this.consultaOscuro?.matches);
    document.documentElement.classList.toggle('tema-oscuro', oscuro);
    this.oscuro.set(oscuro);
  }

  private leer(clave: string): string | null {
    try { return localStorage.getItem(clave); } catch { return null; }
  }

  private leerCache(): Configuracion | null {
    try {
      const c = JSON.parse(this.leer(CLAVE_CACHE) || 'null');
      return c ? { ...CONFIG_ORIGINAL, ...c } : null;
    } catch { return null; }
  }
}
