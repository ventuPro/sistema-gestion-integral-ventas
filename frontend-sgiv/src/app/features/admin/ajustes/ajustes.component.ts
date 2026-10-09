import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule,
         Building2, Palette, Upload, Trash2, RotateCcw, Save, Sun, Moon, MonitorSmartphone,
         Check, ImageIcon, Undo2, Crown, Store } from 'lucide-angular';
import { AjustesService, Configuracion, Tema,
         COLOR_PRIMARIO_ORIGINAL, COLOR_SECUNDARIO_ORIGINAL } from '../../../core/services/ajustes.service';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { AjustesPropietariosComponent } from './propietarios/ajustes-propietarios.component';
import { AjustesSucursalesComponent } from './sucursales/ajustes-sucursales.component';

type Pestana = 'empresa' | 'apariencia' | 'propietarios' | 'sucursales';

interface CampoEmpresa { clave: string; etiqueta: string; ejemplo: string; max: number; tipo?: string; ancho?: boolean }

const CAMPOS_EMPRESA = ['nombre_comercial', 'razon_social', 'nit', 'rubro', 'eslogan', 'telefono', 'whatsapp',
                        'correo', 'sitio_web', 'direccion', 'ciudad', 'pais', 'facebook', 'instagram', 'tiktok'] as const;

const IMAGENES = {
  logo:    { tipos: ['image/png', 'image/jpeg', 'image/webp'], maxKb: 2048 },
  favicon: { tipos: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'], maxKb: 512 }
};

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ImagenUrlPipe,
            AjustesPropietariosComponent, AjustesSucursalesComponent],
  templateUrl: './ajustes.component.html'
})
export class AjustesComponent implements OnInit, OnDestroy {
  private ajustes = inject(AjustesService);
  private cdr     = inject(ChangeDetectorRef);

  readonly icons = {
    empresa: Building2, apariencia: Palette, subir: Upload, quitar: Trash2, original: RotateCcw,
    guardar: Save, claro: Sun, oscuro: Moon, auto: MonitorSmartphone, check: Check,
    imagen: ImageIcon, descartar: Undo2
  };

  readonly COLOR_PRIMARIO_ORIGINAL   = COLOR_PRIMARIO_ORIGINAL;
  readonly COLOR_SECUNDARIO_ORIGINAL = COLOR_SECUNDARIO_ORIGINAL;

  readonly paletas = [
    { nombre: 'Original',  primario: null,      secundario: null },
    { nombre: 'Chocolate', primario: '#92400e', secundario: '#be185d' },
    { nombre: 'Frutilla',  primario: '#db2777', secundario: '#9333ea' },
    { nombre: 'Menta',     primario: '#0f766e', secundario: '#0891b2' },
    { nombre: 'Bosque',    primario: '#15803d', secundario: '#a16207' },
    { nombre: 'Cereza',    primario: '#b91c1c', secundario: '#c2410c' },
    { nombre: 'Lavanda',   primario: '#7c3aed', secundario: '#db2777' },
    { nombre: 'Grafito',   primario: '#334155', secundario: '#0f766e' }
  ];

  readonly colores = [
    { campo: 'color_primario',   nombre: 'Color principal',  original: COLOR_PRIMARIO_ORIGINAL },
    { campo: 'color_secundario', nombre: 'Color secundario', original: COLOR_SECUNDARIO_ORIGINAL }
  ];

  readonly temas: { valor: Tema; nombre: string; detalle: string; icono: any }[] = [
    { valor: 'claro',  nombre: 'Claro',      detalle: 'Fondo blanco',              icono: Sun },
    { valor: 'oscuro', nombre: 'Oscuro',     detalle: 'Descansa la vista de noche', icono: Moon },
    { valor: 'auto',   nombre: 'Automático', detalle: 'Según el dispositivo',      icono: MonitorSmartphone }
  ];

  readonly gruposEmpresa: { titulo: string; campos: CampoEmpresa[] }[] = [
    { titulo: 'Identidad', campos: [
      { clave: 'nombre_comercial', etiqueta: 'Nombre comercial *', ejemplo: "Pastelería Ricky's", max: 100 },
      { clave: 'rubro',            etiqueta: 'Rubro',               ejemplo: 'Pastelería, cafetería, panadería…', max: 60 },
      { clave: 'eslogan',          etiqueta: 'Eslogan',             ejemplo: 'El sabor de siempre', max: 150, ancho: true }
    ]},
    { titulo: 'Datos legales', campos: [
      { clave: 'razon_social', etiqueta: 'Razón social', ejemplo: 'Ricky’s S.R.L.', max: 150 },
      { clave: 'nit',          etiqueta: 'NIT',          ejemplo: '1234567019', max: 20 }
    ]},
    { titulo: 'Contacto', campos: [
      { clave: 'telefono',  etiqueta: 'Teléfono',  ejemplo: '2 2123456', max: 20, tipo: 'tel' },
      { clave: 'whatsapp',  etiqueta: 'WhatsApp',  ejemplo: '+591 70000000', max: 20, tipo: 'tel' },
      { clave: 'correo',    etiqueta: 'Correo',    ejemplo: 'contacto@negocio.com', max: 100, tipo: 'email' },
      { clave: 'sitio_web', etiqueta: 'Sitio web', ejemplo: 'https://www.negocio.com', max: 150, tipo: 'url' }
    ]},
    { titulo: 'Ubicación', campos: [
      { clave: 'direccion', etiqueta: 'Dirección', ejemplo: 'Av. 6 de Agosto #123, Sopocachi', max: 250, ancho: true },
      { clave: 'ciudad',    etiqueta: 'Ciudad',    ejemplo: 'La Paz', max: 60 },
      { clave: 'pais',      etiqueta: 'País',      ejemplo: 'Bolivia', max: 60 }
    ]},
    { titulo: 'Redes sociales', campos: [
      { clave: 'facebook',  etiqueta: 'Facebook',  ejemplo: 'https://facebook.com/negocio', max: 150, tipo: 'url' },
      { clave: 'instagram', etiqueta: 'Instagram', ejemplo: 'https://instagram.com/negocio', max: 150, tipo: 'url' },
      { clave: 'tiktok',    etiqueta: 'TikTok',    ejemplo: 'https://tiktok.com/@negocio', max: 150, tipo: 'url' }
    ]}
  ];

  readonly pestanas: { id: Pestana; nombre: string; icono: any }[] = [
    { id: 'empresa',      nombre: 'Empresa',      icono: Building2 },
    { id: 'apariencia',   nombre: 'Apariencia',   icono: Palette },
    { id: 'propietarios', nombre: 'Propietarios', icono: Crown },
    { id: 'sucursales',   nombre: 'Sucursales',   icono: Store }
  ];

  pestana: Pestana = 'empresa';
  cargando = true;
  guardando = false;
  mensajeExito: string | null = null;
  mensajeError: string | null = null;
  fechaActualizacion: string | null = null;

  empresa: Record<string, string> = {};
  apariencia = { color_primario: null as string | null, color_secundario: null as string | null, tema: 'claro' as Tema };
  /** undefined = sin cambios; null = quitar; data URI = imagen nueva */
  logoNuevo: string | null | undefined = undefined;
  faviconNuevo: string | null | undefined = undefined;
  private guardado!: Configuracion;

  ngOnInit() { this.cargar(); }

  ngOnDestroy() { this.ajustes.restaurarVista(); }

  cargar() {
    this.cargando = true;
    this.ajustes.obtenerCompleto().subscribe({
      next: (c) => { this.llenar(c); this.cargando = false; this.cdr.detectChanges(); },
      error: () => {
        this.cargando = false;
        this.mostrarError('No se pudieron cargar los ajustes.');
      }
    });
  }

  private llenar(c: Configuracion) {
    this.guardado = c;
    this.fechaActualizacion = c.fecha_actualizacion || null;
    this.empresa = {};
    CAMPOS_EMPRESA.forEach(k => this.empresa[k] = (c as any)[k] ?? '');
    this.apariencia = { color_primario: c.color_primario, color_secundario: c.color_secundario, tema: c.tema };
    this.logoNuevo = this.faviconNuevo = undefined;
  }

  // ─── Empresa ───
  guardarEmpresa() {
    if (!this.empresa['nombre_comercial']?.trim()) return this.mostrarError('El nombre comercial es obligatorio.');
    this.guardando = true;
    this.ajustes.guardarEmpresa(this.empresa).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.terminar('✓ Datos de la empresa guardados'); },
      error: (e) => { this.guardando = false; this.mostrarError(e?.error?.error || 'No se pudieron guardar los datos.'); }
    });
  }

  // ─── Apariencia (con vista previa en vivo) ───
  get logoVista(): string | null {
    return this.logoNuevo !== undefined ? this.logoNuevo : this.guardado?.url_logo ?? null;
  }

  get faviconVista(): string | null {
    return this.faviconNuevo !== undefined ? this.faviconNuevo : this.guardado?.url_favicon ?? null;
  }

  get hayCambiosApariencia(): boolean {
    const g = this.guardado;
    return !!g && (this.logoNuevo !== undefined || this.faviconNuevo !== undefined ||
      this.apariencia.color_primario !== g.color_primario ||
      this.apariencia.color_secundario !== g.color_secundario || this.apariencia.tema !== g.tema);
  }

  previsualizar() {
    this.ajustes.previsualizar({
      ...this.apariencia,
      url_logo: this.logoVista,
      url_favicon: this.faviconVista
    });
  }

  cambiarColor(campo: 'color_primario' | 'color_secundario', valor: string | null) {
    const hex = valor?.trim().toLowerCase() || null;
    if (hex && !/^#[0-9a-f]{6}$/.test(hex)) return;
    this.apariencia[campo] = hex;
    this.previsualizar();
  }

  elegirPaleta(p: { primario: string | null; secundario: string | null }) {
    this.apariencia.color_primario = p.primario;
    this.apariencia.color_secundario = p.secundario;
    this.previsualizar();
  }

  esPaletaActual(p: { primario: string | null; secundario: string | null }): boolean {
    return this.apariencia.color_primario === p.primario && this.apariencia.color_secundario === p.secundario;
  }

  elegirTema(t: Tema) {
    this.apariencia.tema = t;
    this.previsualizar();
  }

  seleccionarImagen(evento: Event, tipo: 'logo' | 'favicon') {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    const regla = IMAGENES[tipo];
    if (!regla.tipos.includes(archivo.type))
      return this.mostrarError(tipo === 'logo' ? 'El logo debe ser PNG, JPG o WEBP.' : 'El ícono debe ser PNG o ICO.');
    if (archivo.size > regla.maxKb * 1024)
      return this.mostrarError(`La imagen no debe superar ${regla.maxKb >= 1024 ? regla.maxKb / 1024 + ' MB' : regla.maxKb + ' KB'}.`);

    const lector = new FileReader();
    lector.onload = () => {
      if (tipo === 'logo') this.logoNuevo = lector.result as string;
      else this.faviconNuevo = lector.result as string;
      this.previsualizar();
      this.cdr.detectChanges();
    };
    lector.readAsDataURL(archivo);
  }

  quitarImagen(tipo: 'logo' | 'favicon') {
    if (tipo === 'logo') this.logoNuevo = null;
    else this.faviconNuevo = null;
    this.previsualizar();
  }

  descartarApariencia() {
    this.llenar(this.guardado);
    this.ajustes.restaurarVista();
  }

  guardarApariencia() {
    const datos: any = { ...this.apariencia };
    if (this.logoNuevo !== undefined) datos.logo = this.logoNuevo;
    if (this.faviconNuevo !== undefined) datos.favicon = this.faviconNuevo;
    this.guardando = true;
    this.ajustes.guardarApariencia(datos).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.terminar('✓ Apariencia guardada'); },
      error: (e) => { this.guardando = false; this.mostrarError(e?.error?.error || 'No se pudo guardar la apariencia.'); }
    });
  }

  // ─── Mensajes ───
  private terminar(mensaje: string) {
    this.guardando = false;
    this.mensajeError = null;
    this.mensajeExito = mensaje;
    this.cdr.detectChanges();
    setTimeout(() => { this.mensajeExito = null; this.cdr.detectChanges(); }, 3500);
  }

  private mostrarError(mensaje: string) {
    this.mensajeError = mensaje;
    this.cdr.detectChanges();
    setTimeout(() => { this.mensajeError = null; this.cdr.detectChanges(); }, 5000);
  }
}
