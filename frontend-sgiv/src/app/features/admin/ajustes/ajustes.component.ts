import { Component, computed, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule,
         Building2, Palette, Upload, RotateCcw, Save, Sun, Moon, MonitorSmartphone,
         ImageIcon, Undo2, Crown, Store, SlidersHorizontal, Sparkles } from 'lucide-angular';
import { AjustesService, Configuracion, Tema,
         COLOR_PRIMARIO_ORIGINAL, COLOR_SECUNDARIO_ORIGINAL } from '../../../core/services/ajustes.service';
import { ImagenUrlPipe } from '../../../core/pipes/imagen-url.pipe';
import { AjustesPropietariosComponent } from './propietarios/ajustes-propietarios.component';
import { AjustesSucursalesComponent } from './sucursales/ajustes-sucursales.component';
import { AjustesParametrosComponent } from './parametros/ajustes-parametros.component';
import { AjustesIaComponent } from './ia/ajustes-ia.component';
import { DialogoService } from '../../../core/services/dialogo.service';

type Pestana = 'empresa' | 'apariencia' | 'propietarios' | 'sucursales' | 'parametros' | 'ia';

interface CampoEmpresa { clave: string; etiqueta: string; ejemplo: string; max: number; tipo?: string; ancho?: boolean }

const CAMPOS_EMPRESA = ['nombre_comercial', 'razon_social', 'nit', 'rubro', 'eslogan', 'telefono', 'whatsapp',
                        'correo', 'sitio_web', 'direccion', 'ciudad', 'pais', 'facebook', 'instagram', 'tiktok',
                        'login_titulo'] as const;

const IMAGENES = {
  logo:    { tipos: ['image/png', 'image/jpeg', 'image/webp'], maxKb: 2048 },
  favicon: { tipos: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'], maxKb: 512 }
};

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, ImagenUrlPipe,
            AjustesPropietariosComponent, AjustesSucursalesComponent, AjustesParametrosComponent, AjustesIaComponent],
  templateUrl: './ajustes.component.html',
  styleUrls: ['../../shared/informe/informe.css', '../../shared/venta/venta.css',
              '../../shared/formulario/formulario.css', './ajustes.css']
})
export class AjustesComponent implements OnInit, OnDestroy {
  private ajustes = inject(AjustesService);
  private dialogo = inject(DialogoService);

  readonly icons = {
    subir: Upload, original: RotateCcw, guardar: Save, imagen: ImageIcon, descartar: Undo2
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

  readonly temas: { valor: Tema; nombre: string; icono: any }[] = [
    { valor: 'claro',  nombre: 'Claro',      icono: Sun },
    { valor: 'oscuro', nombre: 'Oscuro',     icono: Moon },
    { valor: 'auto',   nombre: 'Automático', icono: MonitorSmartphone }
  ];

  readonly gruposEmpresa: { titulo: string; campos: CampoEmpresa[] }[] = [
    { titulo: 'Identidad', campos: [
      { clave: 'nombre_comercial', etiqueta: 'Nombre comercial *', ejemplo: "Pastelería Ricky's", max: 100 },
      { clave: 'rubro',            etiqueta: 'Rubro',               ejemplo: 'Pastelería, cafetería, panadería…', max: 60 },
      { clave: 'eslogan',          etiqueta: 'Eslogan',             ejemplo: 'El sabor de siempre', max: 150, ancho: true }
    ]},
    { titulo: 'Inicio de sesión', campos: [
      { clave: 'login_titulo', etiqueta: 'Texto del inicio de sesión', ejemplo: "Pastelería Ricky's", max: 100, ancho: true }
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
    { id: 'sucursales',   nombre: 'Sucursales',   icono: Store },
    { id: 'parametros',   nombre: 'Parámetros',   icono: SlidersHorizontal },
    { id: 'ia',           nombre: 'Chatbot',      icono: Sparkles }
  ];

  readonly pestana            = signal<Pestana>('empresa');
  readonly cargando           = signal(true);
  readonly guardando          = signal(false);
  readonly fechaActualizacion = signal<string | null>(null);

  readonly empresa    = signal<Record<string, string>>({});
  readonly apariencia = signal({ color_primario: null as string | null, color_secundario: null as string | null, tema: 'claro' as Tema });
  /** undefined = sin cambios; null = quitar; data URI = imagen nueva */
  readonly logoNuevo    = signal<string | null | undefined>(undefined);
  readonly faviconNuevo = signal<string | null | undefined>(undefined);
  private readonly guardado = signal<Configuracion | null>(null);

  readonly logoVista = computed(() => {
    const nuevo = this.logoNuevo();
    return nuevo !== undefined ? nuevo : this.guardado()?.url_logo ?? null;
  });

  readonly faviconVista = computed(() => {
    const nuevo = this.faviconNuevo();
    return nuevo !== undefined ? nuevo : this.guardado()?.url_favicon ?? null;
  });

  readonly hayCambiosApariencia = computed(() => {
    const g = this.guardado(), a = this.apariencia();
    return !!g && (this.logoNuevo() !== undefined || this.faviconNuevo() !== undefined ||
      a.color_primario !== g.color_primario || a.color_secundario !== g.color_secundario || a.tema !== g.tema);
  });

  ngOnInit() { this.cargar(); }

  ngOnDestroy() { this.ajustes.restaurarVista(); }

  cargar() {
    this.cargando.set(true);
    this.ajustes.obtenerCompleto().subscribe({
      next: (c) => { this.llenar(c); this.cargando.set(false); },
      error: () => {
        this.cargando.set(false);
        this.dialogo.error('No se pudieron cargar los ajustes.');
      }
    });
  }

  private llenar(c: Configuracion) {
    this.guardado.set(c);
    this.fechaActualizacion.set(c.fecha_actualizacion || null);
    const empresa: Record<string, string> = {};
    CAMPOS_EMPRESA.forEach(k => empresa[k] = (c as any)[k] ?? '');
    this.empresa.set(empresa);
    this.apariencia.set({ color_primario: c.color_primario, color_secundario: c.color_secundario, tema: c.tema });
    this.logoNuevo.set(undefined);
    this.faviconNuevo.set(undefined);
  }

  // ─── Empresa ───
  guardarEmpresa() {
    if (!this.empresa()['nombre_comercial']?.trim()) return this.dialogo.error('El nombre comercial es obligatorio.');
    this.guardando.set(true);
    this.ajustes.guardarEmpresa(this.empresa()).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.terminar('Datos de la empresa guardados'); },
      error: (e) => { this.guardando.set(false); this.dialogo.error(e?.error?.error || 'No se pudieron guardar los datos.'); }
    });
  }

  // ─── Apariencia (con vista previa en vivo) ───
  previsualizar() {
    this.ajustes.previsualizar({
      ...this.apariencia(),
      url_logo: this.logoVista(),
      url_favicon: this.faviconVista()
    });
  }

  cambiarColor(campo: 'color_primario' | 'color_secundario', valor: string | null) {
    const hex = valor?.trim().toLowerCase() || null;
    if (hex && !/^#[0-9a-f]{6}$/.test(hex)) return;
    this.apariencia.update(a => ({ ...a, [campo]: hex }));
    this.previsualizar();
  }

  elegirPaleta(p: { primario: string | null; secundario: string | null }) {
    this.apariencia.update(a => ({ ...a, color_primario: p.primario, color_secundario: p.secundario }));
    this.previsualizar();
  }

  esPaletaActual(p: { primario: string | null; secundario: string | null }): boolean {
    const a = this.apariencia();
    return a.color_primario === p.primario && a.color_secundario === p.secundario;
  }

  elegirTema(t: Tema) {
    this.apariencia.update(a => ({ ...a, tema: t }));
    this.previsualizar();
  }

  seleccionarImagen(evento: Event, tipo: 'logo' | 'favicon') {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    const regla = IMAGENES[tipo];
    if (!regla.tipos.includes(archivo.type))
      return this.dialogo.error(tipo === 'logo' ? 'El logo debe ser PNG, JPG o WEBP.' : 'El ícono debe ser PNG o ICO.');
    if (archivo.size > regla.maxKb * 1024)
      return this.dialogo.error(`La imagen no debe superar ${regla.maxKb >= 1024 ? regla.maxKb / 1024 + ' MB' : regla.maxKb + ' KB'}.`);

    const lector = new FileReader();
    lector.onload = () => {
      (tipo === 'logo' ? this.logoNuevo : this.faviconNuevo).set(lector.result as string);
      this.previsualizar();
    };
    lector.readAsDataURL(archivo);
  }

  quitarImagen(tipo: 'logo' | 'favicon') {
    (tipo === 'logo' ? this.logoNuevo : this.faviconNuevo).set(null);
    this.previsualizar();
  }

  descartarApariencia() {
    const g = this.guardado();
    if (g) this.llenar(g);
    this.ajustes.restaurarVista();
  }

  guardarApariencia() {
    const datos: any = { ...this.apariencia() };
    if (this.logoNuevo() !== undefined) datos.logo = this.logoNuevo();
    if (this.faviconNuevo() !== undefined) datos.favicon = this.faviconNuevo();
    this.guardando.set(true);
    this.ajustes.guardarApariencia(datos).subscribe({
      next: (r) => { this.llenar(r.configuracion); this.terminar('Apariencia guardada'); },
      error: (e) => { this.guardando.set(false); this.dialogo.error(e?.error?.error || 'No se pudo guardar la apariencia.'); }
    });
  }

  // ─── Mensajes ───
  private terminar(mensaje: string) {
    this.guardando.set(false);
    this.dialogo.avisar(mensaje);
  }
}
