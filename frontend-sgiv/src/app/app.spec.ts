import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { DialogoService } from './core/services/dialogo.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('se crea', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('tiene el outlet de rutas', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
  });

  it('no carga los diálogos hasta usarlos', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(TestBed.inject(DialogoService).activo()).toBeFalsy();
  });
});
