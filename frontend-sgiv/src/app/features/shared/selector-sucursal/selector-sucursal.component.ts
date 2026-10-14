import { Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, Store, Layers, Lock } from 'lucide-angular';

// ─── Selector de sucursal (mismo en Panel, Inventario, Informes y Cierres de caja) ───
// seleccionada = null → "Todas" (solo si todas = true).
// estados: id_sucursal → caja abierta, para mostrar el punto de estado.
@Component({
  selector: 'app-selector-sucursal',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './selector-sucursal.component.html',
  styleUrl: './selector-sucursal.component.css'
})
export class SelectorSucursalComponent {
  readonly sucursales  = input<any[]>([]);
  readonly seleccionada = input<number | null>(null);
  readonly todas       = input(false);
  readonly estados     = input<Record<number, boolean> | null>(null);
  readonly soloLectura = input(false);
  readonly cambio      = output<number | null>();

  readonly icons = { store: Store, todas: Layers, lock: Lock };

  readonly opciones = computed(() => {
    const lista = this.sucursales() || [];
    if (!this.soloLectura()) return lista;
    const propia = lista.find(s => s.id_sucursal === this.seleccionada());
    return propia ? [propia] : lista.slice(0, 1);
  });

  elegir(id: number | null) {
    if (this.soloLectura() || id === this.seleccionada()) return;
    this.cambio.emit(id);
  }

  estado(id: number): boolean | null {
    const e = this.estados();
    return e && id in e ? e[id] : null;
  }
}
