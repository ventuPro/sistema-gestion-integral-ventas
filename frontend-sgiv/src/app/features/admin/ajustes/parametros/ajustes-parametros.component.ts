import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Save, Undo2, RotateCcw, Upload, ImageIcon } from 'lucide-angular';
import { AjustesService, Configuracion } from '../../../../core/services/ajustes.service';
import { ImagenUrlPipe } from '../../../../core/pipes/imagen-url.pipe';
import { DialogoService } from '../../../../core/services/dialogo.service';

interface Parametros {
  moneda_simbolo: string;
  pago_efectivo: boolean;
  pago_qr: boolean;
  ticket_mensaje_pie: string;
  ticket_ancho: '58' | '80' | 'A4';
  menu_activo: boolean;
  menu_mensaje_bienvenida: string;
  menu_minutos_expiracion: number;
  menu_max_pendientes_mesa: number;
  menu_max_pedidos_ip: number;
  menu_visita_horas: number;
  menu_visita_inactividad: number;
  menu_bloqueo_horas: number;
  menu_qr_visita: boolean;
  stock_minimo_defecto: number;
  captcha_activo: boolean;
  login_max_intentos: number;
  login_minutos_bloqueo: number;
  sesion_horas: number;
}

// Mismos valores por defecto que la tabla configuracion
const ORIGINALES: Parametros = {
  moneda_simbolo: 'Bs.', pago_efectivo: true, pago_qr: true, ticket_mensaje_pie: '¡Gracias por su compra!', ticket_ancho: '80',
  menu_activo: true, menu_mensaje_bienvenida: '', menu_minutos_expiracion: 15, menu_max_pendientes_mesa: 3,
  menu_max_pedidos_ip: 10, menu_visita_horas: 3, menu_visita_inactividad: 30, menu_bloqueo_horas: 6,
  menu_qr_visita: false, stock_minimo_defecto: 5, captcha_activo: true, login_max_intentos: 5,
  login_minutos_bloqueo: 15, sesion_horas: 8
};

interface CampoNumero { clave: keyof Parametros; etiqueta: string; min: number; max: number; unidad: string }

// ─── Ajustes → Parámetros ───
@Component({
  selector: 'app-ajustes-parametros',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ImagenUrlPipe],
  templateUrl: './ajustes-parametros.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css', './ajustes-parametros.component.css']
})
export class AjustesParametrosComponent implements OnInit {
  private ajustes = inject(AjustesService);
  private dialogo = inject(DialogoService);

  readonly icons = { guardar: Save, descartar: Undo2, original: RotateCcw, subir: Upload, imagen: ImageIcon };

  readonly monedas = ['Bs.', '$us', '$', 'S/', '€'];

  readonly anchosTicket: { valor: '58' | '80' | 'A4'; nombre: string; escala: number }[] = [
    { valor: '58', nombre: '58 mm', escala: 0.48 },
    { valor: '80', nombre: '80 mm', escala: 0.66 },
    { valor: 'A4', nombre: 'Hoja A4', escala: 1 }
  ];

  readonly camposMenu: CampoNumero[] = [
    { clave: 'menu_minutos_expiracion', etiqueta: 'Vencimiento de pedidos sin confirmar', unidad: 'min', min: 5, max: 120 },
    { clave: 'menu_max_pendientes_mesa', etiqueta: 'Pedidos pendientes por mesa', unidad: 'pedidos', min: 1, max: 10 },
    { clave: 'menu_max_pedidos_ip', etiqueta: 'Pedidos por celular cada 10 minutos', unidad: 'pedidos', min: 1, max: 100 },
    { clave: 'menu_visita_horas', etiqueta: 'Duración máxima de la visita', unidad: 'horas', min: 1, max: 12 },
    { clave: 'menu_visita_inactividad', etiqueta: 'Fin de la visita por inactividad', unidad: 'min', min: 10, max: 240 },
    { clave: 'menu_bloqueo_horas', etiqueta: 'Bloqueo por pedido falso', unidad: 'horas', min: 1, max: 72 }
  ];

  readonly camposSeguridad: CampoNumero[] = [
    { clave: 'login_max_intentos', etiqueta: 'Intentos fallidos permitidos', unidad: 'intentos', min: 3, max: 20 },
    { clave: 'login_minutos_bloqueo', etiqueta: 'Duración del bloqueo', unidad: 'min', min: 1, max: 1440 },
    { clave: 'sesion_horas', etiqueta: 'Duración de la sesión', unidad: 'horas', min: 1, max: 24 }
  ];

  readonly cargando  = signal(true);
  readonly guardando = signal(false);

  // Formulario: se reemplaza con set(); el template edita los campos del objeto actual
  readonly p = signal<Parametros>({ ...ORIGINALES });
  private guardado: Parametros = { ...ORIGINALES };
  readonly qrGuardado = signal<string | null>(null);
  /** undefined = sin cambios; null = quitar; data URI = imagen nueva */
  readonly qrNuevo = signal<string | null | undefined>(undefined);

  readonly qrVista = computed(() => {
    const nuevo = this.qrNuevo();
    return nuevo !== undefined ? nuevo : this.qrGuardado();
  });

  ngOnInit() {
    this.ajustes.obtenerCompleto().subscribe({
      next: (c) => { this.llenar(c); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudieron cargar los parámetros.'); }
    });
  }

  private llenar(c: Configuracion) {
    const p: any = {};
    (Object.keys(ORIGINALES) as (keyof Parametros)[]).forEach(k => p[k] = (c as any)[k] ?? ORIGINALES[k]);
    p.menu_mensaje_bienvenida = c.menu_mensaje_bienvenida || '';
    this.p.set(p);
    this.guardado = { ...p };
    this.qrGuardado.set(c.url_qr_cobro);
    this.qrNuevo.set(undefined);
  }

  get hayCambios(): boolean {
    const p = this.p();
    return this.qrNuevo() !== undefined ||
      (Object.keys(ORIGINALES) as (keyof Parametros)[]).some(k => String(p[k]) !== String(this.guardado[k]));
  }

  get esOriginal(): boolean {
    const p = this.p();
    return !this.qrVista() && (Object.keys(ORIGINALES) as (keyof Parametros)[])
      .every(k => String(p[k]) === String(ORIGINALES[k]));
  }

  /** Al menos un método de pago queda activo */
  cambiarPago(metodo: 'pago_efectivo' | 'pago_qr') {
    const otro = metodo === 'pago_efectivo' ? 'pago_qr' : 'pago_efectivo';
    const p = this.p();
    if (p[metodo] && !p[otro])
      return this.dialogo.error('Debe quedar al menos un método de pago habilitado.');
    p[metodo] = !p[metodo];
  }

  seleccionarQr(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type))
      return this.dialogo.error('La imagen del QR debe ser PNG, JPG o WEBP.');
    if (archivo.size > 2 * 1024 * 1024) return this.dialogo.error('La imagen no debe superar 2 MB.');
    const lector = new FileReader();
    lector.onload = () => this.qrNuevo.set(lector.result as string);
    lector.readAsDataURL(archivo);
  }

  quitarQr() { this.qrNuevo.set(null); }

  restaurarOriginales() {
    this.p.set({ ...ORIGINALES });
    if (this.qrGuardado()) this.qrNuevo.set(null);
  }

  descartar() {
    this.p.set({ ...this.guardado });
    this.qrNuevo.set(undefined);
  }

  guardar() {
    const fuera = [...this.camposMenu, ...this.camposSeguridad,
                   { clave: 'stock_minimo_defecto', etiqueta: 'Stock mínimo por defecto', min: 0, max: 10000 } as CampoNumero]
      .find(c => { const n = Number(this.p()[c.clave]); return !Number.isInteger(n) || n < c.min || n > c.max; });
    if (fuera) return this.dialogo.error(`${fuera.etiqueta}: debe ser un número entero entre ${fuera.min} y ${fuera.max}.`);
    if (!this.p().moneda_simbolo.trim()) return this.dialogo.error('El símbolo de moneda es obligatorio.');
    if (!this.p().ticket_mensaje_pie.trim()) return this.dialogo.error('El mensaje del pie del ticket es obligatorio.');

    const datos: any = { ...this.p() };
    if (this.qrNuevo() !== undefined) datos.qr_cobro = this.qrNuevo();
    this.guardando.set(true);
    this.ajustes.guardarParametros(datos).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.guardando.set(false); this.dialogo.avisar('Parámetros guardados'); },
      error: (e) => { this.guardando.set(false); this.dialogo.error(e?.error?.error || 'No se pudieron guardar los parámetros.'); }
    });
  }
}
