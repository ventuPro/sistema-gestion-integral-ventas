import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PuntoVenta } from './punto-venta';

describe('PuntoVenta', () => {
  let component: PuntoVenta;
  let fixture: ComponentFixture<PuntoVenta>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PuntoVenta],
    }).compileComponents();

    fixture = TestBed.createComponent(PuntoVenta);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
