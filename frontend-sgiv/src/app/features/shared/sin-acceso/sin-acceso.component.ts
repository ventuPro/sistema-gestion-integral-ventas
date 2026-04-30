import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sin-acceso',
  standalone: true,
  imports: [],
  template: `
    <div class="flex flex-col items-center justify-center h-full py-20 text-center">
      <div class="text-6xl mb-4">🔒</div>
      <h2 class="text-2xl font-bold text-gray-800 mb-2">Sin acceso</h2>
      <p class="text-gray-500 mb-6">No tienes permisos para este módulo.<br>Contacta al Administrador.</p>
      <button (click)="volver()"
              class="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors">
        Volver al inicio
      </button>
    </div>
  `
})
export class SinAccesoComponent {
  constructor(private router: Router) {}
  volver() { this.router.navigate(['/dashboard']); }
}