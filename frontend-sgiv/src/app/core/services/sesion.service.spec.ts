import { TestBed } from '@angular/core/testing';
import { ROL, SesionService, UsuarioSesion } from './sesion.service';

const cajero: UsuarioSesion = {
  id_usuario: 2, nombre_completo: 'Olivia Pérez', id_rol: ROL.cajero, id_sucursal: 3, nombre_sucursal: 'Norte'
};

describe('SesionService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('sin sesión guardada no hay usuario', () => {
    const s = TestBed.inject(SesionService);
    expect(s.usuario()).toBeNull();
    expect(s.esAdmin()).toBe(false);
    expect(s.idSucursal()).toBe(1);
  });

  it('iniciar guarda el usuario y calcula rol y sucursal', () => {
    const s = TestBed.inject(SesionService);
    s.iniciar({ ...cajero, id_rol: '2' as any, id_sucursal: '3' as any });
    expect(s.esCajero()).toBe(true);
    expect(s.esAdmin()).toBe(false);
    expect(s.idSucursal()).toBe(3);
    expect(JSON.parse(localStorage.getItem('usuario_sgiv')!).nombre_completo).toBe('Olivia Pérez');
  });

  it('lee la sesión guardada al crearse y cerrar la borra', () => {
    localStorage.setItem('usuario_sgiv', JSON.stringify({ ...cajero, id_rol: ROL.administrador }));
    const s = TestBed.inject(SesionService);
    expect(s.esAdmin()).toBe(true);
    s.cerrar();
    expect(s.usuario()).toBeNull();
    expect(localStorage.getItem('usuario_sgiv')).toBeNull();
  });

  it('se entera cuando otra pestaña cierra la sesión', () => {
    const s = TestBed.inject(SesionService);
    s.iniciar(cajero);
    localStorage.removeItem('usuario_sgiv');
    window.dispatchEvent(new StorageEvent('storage', { key: 'usuario_sgiv' }));
    expect(s.usuario()).toBeNull();
  });
});
