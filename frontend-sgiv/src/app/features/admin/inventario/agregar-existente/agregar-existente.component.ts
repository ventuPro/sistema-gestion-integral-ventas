import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule, X, Search, PackagePlus } from 'lucide-angular';
import { ProductoService } from '../../../../core/services/producto.service';
import { AjustesService } from '../../../../core/services/ajustes.service';
import { DialogoService } from '../../../../core/services/dialogo.service';
import { FondoModalDirective } from '../../../../core/directives/fondo-modal.directive';

// ─── Inventario → «Agregar de otra sucursal»: el MISMO producto (receta, costo, precio) en esta sucursal ───
// Evita crear el producto otra vez con otro nombre.
@Component({
  selector: 'app-agregar-existente',
  standalone: true,
  imports: [FondoModalDirective, LucideAngularModule],
  templateUrl: './agregar-existente.component.html',
  styleUrls: ['../../../shared/informe/informe.css', '../../../shared/venta/venta.css', '../../../shared/formulario/formulario.css']
})
export class AgregarExistenteComponent implements OnInit {
  private productos = inject(ProductoService);
  private dialogo   = inject(DialogoService);
  readonly moneda   = inject(AjustesService).moneda;

  readonly idSucursal     = input.required<number>();
  readonly nombreSucursal = input('');
  readonly cerrar         = output<void>();
  readonly agregados      = output<void>();

  readonly icons = { cerrar: X, buscar: Search, agregar: PackagePlus };

  readonly lista     = signal<any[]>([]);
  readonly estado    = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly busqueda  = signal('');
  /** id_producto → stock inicial (null = vacío, entra en 0) */
  readonly elegidos  = signal<ReadonlyMap<number, number | null>>(new Map());
  readonly guardando = signal(false);

  readonly secciones = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const grupos = new Map<number, { id: number; nombre: string; productos: any[] }>();
    for (const p of this.lista()) {
      if (texto && !p.nombre_producto.toLowerCase().includes(texto)) continue;
      const g = grupos.get(p.id_categoria) ?? { id: p.id_categoria, nombre: p.nombre_categoria, productos: [] as any[] };
      g.productos.push(p);
      grupos.set(p.id_categoria, g);
    }
    return [...grupos.values()];
  });
  readonly cantidad = computed(() => this.elegidos().size);

  ngOnInit() {
    this.productos.faltantes(this.idSucursal()).subscribe({
      next:  (l) => { this.lista.set(l); this.estado.set('listo'); },
      error: () => this.estado.set('error')
    });
  }

  alternar(p: any) {
    this.elegidos.update(m => {
      const n = new Map(m);
      if (n.has(p.id_producto)) n.delete(p.id_producto); else n.set(p.id_producto, null);
      return n;
    });
  }

  /** Escribir un stock elige el producto */
  fijarStock(p: any, valor: string) {
    const v = valor === '' ? null : Math.max(0, Math.floor(Number(valor)) || 0);
    this.elegidos.update(m => new Map(m).set(p.id_producto, v));
  }

  async agregar() {
    if (!this.cantidad() || this.guardando()) return;
    const n = this.cantidad();
    if (!(await this.dialogo.confirmar({
      titulo: `¿Agregar ${n} ${n === 1 ? 'producto' : 'productos'} a ${this.nombreSucursal() || 'esta sucursal'}?`,
      textoConfirmar: 'Agregar'
    }))) return;
    this.guardando.set(true);
    const productos = [...this.elegidos()].map(([id_producto, stock]) => ({ id_producto, stock_inicial: stock ?? 0 }));
    this.productos.agregarASucursal(this.idSucursal(), productos).subscribe({
      next: () => {
        this.guardando.set(false);
        this.dialogo.avisar(n === 1 ? 'Producto agregado' : `${n} productos agregados`);
        this.agregados.emit();
      },
      error: (e) => { this.guardando.set(false); this.dialogo.error(e?.error?.error || 'No se pudieron agregar.'); }
    });
  }
}
