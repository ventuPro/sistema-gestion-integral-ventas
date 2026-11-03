import { Component, inject, OnInit, signal } from '@angular/core';
import { LucideAngularModule, Save, Send, Unlink, ExternalLink } from 'lucide-angular';
import { AjustesService, EstadoTelegram, UsuarioTelegram } from '../../../../core/services/ajustes.service';
import { DialogoService } from '../../../../core/services/dialogo.service';

/** Valor del selector «Avisos de»: 'todas', 'ninguna' o el id de la sucursal */
interface Borrador { telefono: string; avisos: string }

// ─── Ajustes → Telegram: teléfono de cada persona, sucursal de la que recibe avisos y vínculo ───
@Component({
  selector: 'app-ajustes-telegram',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './ajustes-telegram.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css',
              '../../../shared/formulario/formulario.css', '../ajustes.css', './ajustes-telegram.component.css']
})
export class AjustesTelegramComponent implements OnInit {
  private ajustes = inject(AjustesService);
  private dialogo = inject(DialogoService);

  readonly icons = { guardar: Save, probar: Send, desvincular: Unlink, abrir: ExternalLink };

  readonly cargando  = signal(true);
  readonly estado    = signal<EstadoTelegram | null>(null);
  readonly borradores = signal<Record<number, Borrador>>({});
  readonly ocupado   = signal<number | null>(null);

  ngOnInit() { this.cargar(); }

  cargar() {
    this.ajustes.telegram().subscribe({
      next: (e) => { this.estado.set(e); this.llenar(e.usuarios); this.cargando.set(false); },
      error: () => { this.cargando.set(false); this.dialogo.error('No se pudo cargar Telegram.'); }
    });
  }

  private llenar(usuarios: UsuarioTelegram[]) {
    this.estado.update(e => e && { ...e, usuarios });
    this.borradores.set(Object.fromEntries(usuarios.map(u => [u.id_usuario, this.original(u)])));
  }

  private original(u: UsuarioTelegram): Borrador {
    return {
      telefono: this.mostrarTelefono(u.telefono),
      avisos: !u.avisos_telegram ? 'ninguna' : u.avisos_sucursal ? String(u.avisos_sucursal) : 'todas'
    };
  }

  /** 59171234567 → 71234567 (los números de Bolivia se muestran sin el código de país) */
  private mostrarTelefono(t: string | null) {
    if (!t) return '';
    return t.startsWith('591') && t.length === 11 ? t.slice(3) : `+${t}`;
  }

  borrador(u: UsuarioTelegram) { return this.borradores()[u.id_usuario] ?? this.original(u); }

  cambiar(u: UsuarioTelegram, campo: keyof Borrador, valor: string) {
    this.borradores.update(b => ({ ...b, [u.id_usuario]: { ...this.borrador(u), [campo]: valor } }));
  }

  hayCambios(u: UsuarioTelegram) {
    const a = this.borrador(u), b = this.original(u);
    return a.telefono.trim() !== b.telefono || a.avisos !== b.avisos;
  }

  guardar(u: UsuarioTelegram) {
    const b = this.borrador(u);
    this.ocupado.set(u.id_usuario);
    this.ajustes.guardarTelegramUsuario(u.id_usuario, {
      telefono: b.telefono.trim() || null,
      avisos_telegram: b.avisos !== 'ninguna',
      avisos_sucursal: /^\d+$/.test(b.avisos) ? Number(b.avisos) : null
    }).subscribe({
      next: (r) => { this.ocupado.set(null); this.llenar(r.usuarios); this.dialogo.avisar('Guardado.'); },
      error: (e) => { this.ocupado.set(null); this.dialogo.error(e.error?.error || 'No se pudo guardar.'); }
    });
  }

  probar(u: UsuarioTelegram) {
    this.ocupado.set(u.id_usuario);
    this.ajustes.probarTelegramUsuario(u.id_usuario).subscribe({
      next: () => { this.ocupado.set(null); this.dialogo.avisar(`Mensaje de prueba enviado a ${u.nombre_completo}.`); },
      error: (e) => { this.ocupado.set(null); this.dialogo.error(e.error?.error || 'No se pudo enviar.'); }
    });
  }

  async desvincular(u: UsuarioTelegram) {
    const si = await this.dialogo.confirmar({
      titulo: `¿Desvincular el Telegram de ${u.nombre_completo}?`,
      mensaje: 'Dejará de recibir avisos y códigos hasta que vuelva a compartir su número con el bot.',
      textoConfirmar: 'Desvincular', peligro: true
    });
    if (!si) return;
    this.ocupado.set(u.id_usuario);
    this.ajustes.desvincularTelegramUsuario(u.id_usuario).subscribe({
      next: (r) => { this.ocupado.set(null); this.llenar(r.usuarios); },
      error: (e) => { this.ocupado.set(null); this.dialogo.error(e.error?.error || 'No se pudo desvincular.'); }
    });
  }
}
