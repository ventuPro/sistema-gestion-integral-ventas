import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Save, Undo2, RotateCcw, Upload, ImageIcon } from 'lucide-angular';
import { AjustesService, Configuracion } from '../../../../core/services/ajustes.service';
import { ImagenUrlPipe } from '../../../../core/pipes/imagen-url.pipe';

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
  menu_max_pedidos_ip: 10, stock_minimo_defecto: 5, captcha_activo: true, login_max_intentos: 5,
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
  private cdr     = inject(ChangeDetectorRef);

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
    { clave: 'menu_max_pedidos_ip', etiqueta: 'Pedidos por celular cada 10 minutos', unidad: 'pedidos', min: 1, max: 100 }
  ];

  readonly camposSeguridad: CampoNumero[] = [
    { clave: 'login_max_intentos', etiqueta: 'Intentos fallidos permitidos', unidad: 'intentos', min: 3, max: 20 },
    { clave: 'login_minutos_bloqueo', etiqueta: 'Duración del bloqueo', unidad: 'min', min: 1, max: 1440 },
    { clave: 'sesion_horas', etiqueta: 'Duración de la sesión', unidad: 'horas', min: 1, max: 24 }
  ];

  cargando = true;
  guardando = false;
  mensaje: { tipo: 'ok' | 'error'; texto: string } | null = null;

  p: Parametros = { ...ORIGINALES };
  private guardado: Parametros = { ...ORIGINALES };
  qrGuardado: string | null = null;
  /** undefined = sin cambios; null = quitar; data URI = imagen nueva */
  qrNuevo: string | null | undefined = undefined;

  ngOnInit() {
    this.ajustes.obtenerCompleto().subscribe({
      next: (c) => { this.llenar(c); this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.avisar('error', 'No se pudieron cargar los parámetros.'); }
    });
  }

  private llenar(c: Configuracion) {
    const p: any = {};
    (Object.keys(ORIGINALES) as (keyof Parametros)[]).forEach(k => p[k] = (c as any)[k] ?? ORIGINALES[k]);
    p.menu_mensaje_bienvenida = c.menu_mensaje_bienvenida || '';
    this.p = p;
    this.guardado = { ...p };
    this.qrGuardado = c.url_qr_cobro;
    this.qrNuevo = undefined;
  }

  get qrVista(): string | null {
    return this.qrNuevo !== undefined ? this.qrNuevo : this.qrGuardado;
  }

  get hayCambios(): boolean {
    return this.qrNuevo !== undefined ||
      (Object.keys(ORIGINALES) as (keyof Parametros)[]).some(k => String(this.p[k]) !== String(this.guardado[k]));
  }

  get esOriginal(): boolean {
    return !this.qrVista && (Object.keys(ORIGINALES) as (keyof Parametros)[])
      .every(k => String(this.p[k]) === String(ORIGINALES[k]));
  }

  /** Al menos un método de pago queda activo */
  cambiarPago(metodo: 'pago_efectivo' | 'pago_qr') {
    const otro = metodo === 'pago_efectivo' ? 'pago_qr' : 'pago_efectivo';
    if (this.p[metodo] && !this.p[otro])
      return this.avisar('error', 'Debe quedar al menos un método de pago habilitado.');
    this.p[metodo] = !this.p[metodo];
  }

  seleccionarQr(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type))
      return this.avisar('error', 'La imagen del QR debe ser PNG, JPG o WEBP.');
    if (archivo.size > 2 * 1024 * 1024) return this.avisar('error', 'La imagen no debe superar 2 MB.');
    const lector = new FileReader();
    lector.onload = () => { this.qrNuevo = lector.result as string; this.cdr.detectChanges(); };
    lector.readAsDataURL(archivo);
  }

  quitarQr() { this.qrNuevo = null; }

  restaurarOriginales() {
    this.p = { ...ORIGINALES };
    if (this.qrGuardado) this.qrNuevo = null;
  }

  descartar() {
    this.p = { ...this.guardado };
    this.qrNuevo = undefined;
  }

  guardar() {
    const fuera = [...this.camposMenu, ...this.camposSeguridad,
                   { clave: 'stock_minimo_defecto', etiqueta: 'Stock mínimo por defecto', min: 0, max: 10000 } as CampoNumero]
      .find(c => { const n = Number(this.p[c.clave]); return !Number.isInteger(n) || n < c.min || n > c.max; });
    if (fuera) return this.avisar('error', `${fuera.etiqueta}: debe ser un número entero entre ${fuera.min} y ${fuera.max}.`);
    if (!this.p.moneda_simbolo.trim()) return this.avisar('error', 'El símbolo de moneda es obligatorio.');
    if (!this.p.ticket_mensaje_pie.trim()) return this.avisar('error', 'El mensaje del pie del ticket es obligatorio.');

    const datos: any = { ...this.p };
    if (this.qrNuevo !== undefined) datos.qr_cobro = this.qrNuevo;
    this.guardando = true;
    this.ajustes.guardarParametros(datos).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.guardando = false; this.avisar('ok', 'Parámetros guardados'); },
      error: (e) => { this.guardando = false; this.avisar('error', e?.error?.error || 'No se pudieron guardar los parámetros.'); }
    });
  }

  private avisar(tipo: 'ok' | 'error', texto: string) {
    this.mensaje = { tipo, texto };
    this.cdr.detectChanges();
    setTimeout(() => { this.mensaje = null; this.cdr.detectChanges(); }, 4500);
  }
}
