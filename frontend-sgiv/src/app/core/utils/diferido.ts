import { Type, effect, signal } from '@angular/core';

/**
 * Descarga un componente con import() la primera vez que `condicion` se cumple.
 * Se usa con *ngComponentOutlet (sin @defer, que suma su código a la carga inicial).
 * Llamar en el inicializador de un campo (contexto de inyección).
 */
export const componenteDiferido = <T>(condicion: () => boolean, cargar: () => Promise<Type<T>>) => {
  const componente = signal<Type<T> | null>(null);
  let pedido = false;
  effect(() => {
    if (pedido || !condicion()) return;
    pedido = true;
    cargar().then(c => componente.set(c)).catch(() => { pedido = false; });
  });
  return componente.asReadonly();
};
