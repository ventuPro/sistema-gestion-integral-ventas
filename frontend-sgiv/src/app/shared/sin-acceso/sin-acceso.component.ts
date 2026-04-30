import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sin-acceso',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sin-acceso.component.html'
})
export class SinAccesoComponent {
  constructor(private router: Router) {}
  volver() { this.router.navigate(['/dashboard']); }
}