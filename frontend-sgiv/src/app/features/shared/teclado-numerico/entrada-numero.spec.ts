import { signal } from '@angular/core';
import { aplicarTecla, campoDe, EntradaMonto } from './entrada-numero';

describe('Tablero numérico', () => {
  it('escribe cifras, punto y borra', () => {
    expect(aplicarTecla('', '5')).toBe('5');
    expect(aplicarTecla('0', '7')).toBe('7');
    expect(aplicarTecla('12', '.')).toBe('12.');
    expect(aplicarTecla('', '.')).toBe('0.');
    expect(aplicarTecla('12.5', '.')).toBe('12.5');
    expect(aplicarTecla('12.50', '3')).toBe('12.50');
    expect(aplicarTecla('125', 'borrar')).toBe('12');
    expect(aplicarTecla('125', 'limpiar')).toBe('');
  });

  it('cantidades: sin decimales y la primera cifra reemplaza', () => {
    expect(aplicarTecla('2', '.', { decimales: false })).toBe('2');
    expect(aplicarTecla('2', '5', { decimales: false, reemplazar: true })).toBe('5');
    expect(aplicarTecla('2', 'borrar', { decimales: false, reemplazar: true })).toBe('');
  });

  it('monto: actualiza la señal y suma billetes', () => {
    const monto = signal<number | null>(null);
    const e = new EntradaMonto(monto);
    e.tecla('2'); e.tecla('0'); e.tecla('.');
    expect(e.mostrado()).toBe('20.');
    expect(monto()).toBe(20);
    e.tecla('5');
    expect(monto()).toBe(20.5);
    e.sumar(50);
    expect(monto()).toBe(70.5);
    expect(e.mostrado()).toBe('70.5');
    e.tecla('limpiar');
    expect(monto()).toBeNull();
  });

  it('descuento: escribe en el campo del formulario', () => {
    const form = signal({ tipo: 'PORCENTAJE', valor: null as number | null, motivo: '' });
    const e = new EntradaMonto(campoDe(form, 'valor'));
    e.tecla('1'); e.tecla('5');
    expect(form().valor).toBe(15);
    form().valor = 3;            // escrito con el teclado físico (ngModel cambia el objeto)
    e.tecla('0');
    expect(form().valor).toBe(30);
    expect(form().tipo).toBe('PORCENTAJE');
  });
});
