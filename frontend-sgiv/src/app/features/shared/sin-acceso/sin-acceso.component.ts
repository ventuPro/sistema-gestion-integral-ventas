import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sin-acceso',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full overflow-hidden bg-gradient-to-br from-amber-50 via-rose-50 to-pink-50 rounded-2xl">

      <div class="absolute -top-10 -right-10 text-[12rem] opacity-10 select-none rotate-12">🧁</div>
      <div class="absolute -bottom-12 -left-8 text-[11rem] opacity-10 select-none -rotate-12">🍰</div>
      <div class="absolute top-1/3 left-1/4 text-7xl opacity-10 select-none">🎂</div>
      <div class="absolute top-12 left-1/3 text-5xl opacity-10 select-none">🍩</div>
      <div class="absolute bottom-20 right-1/4 text-6xl opacity-10 select-none">🥐</div>

      <div class="relative flex flex-col items-center justify-center h-full px-6 py-12 text-center">

        <div class="text-7xl mb-4 animate-bounce" style="animation-duration:3s">🧁</div>

        <p class="text-sm font-semibold text-rose-500 uppercase tracking-widest mb-1">
          {{ saludo }}, {{ nombreCorto }}
        </p>

        <h1 class="text-4xl md:text-5xl font-black text-gray-800 mb-3 leading-tight">
          Bienvenido a <span class="text-rose-600">Pastelería Ricky's</span>
        </h1>

        <p class="text-gray-500 max-w-md text-sm md:text-base mb-2">
          {{ frase }}
        </p>
        <p class="text-xs text-gray-400 mb-8">{{ fechaFormateada }}</p>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl w-full">
          <div class="bg-white/80 backdrop-blur border border-rose-100 rounded-xl p-3 shadow-sm">
            <div class="text-2xl mb-1">📋</div>
            <p class="text-xs font-bold text-gray-700">Toma pedidos</p>
            <p class="text-[11px] text-gray-500">desde Mesas o POS</p>
          </div>
          <div class="bg-white/80 backdrop-blur border border-amber-100 rounded-xl p-3 shadow-sm">
            <div class="text-2xl mb-1">💰</div>
            <p class="text-xs font-bold text-gray-700">Registra ventas</p>
            <p class="text-[11px] text-gray-500">en Punto de Venta</p>
          </div>
          <div class="bg-white/80 backdrop-blur border border-pink-100 rounded-xl p-3 shadow-sm col-span-2 md:col-span-1">
            <div class="text-2xl mb-1">🧾</div>
            <p class="text-xs font-bold text-gray-700">Cierra tu caja</p>
            <p class="text-[11px] text-gray-500">al fin del turno</p>
          </div>
        </div>

        <p class="mt-8 text-xs text-gray-400 italic">
          Usa el menú lateral para empezar a trabajar.
        </p>
      </div>
    </div>
  `
})
export class SinAccesoComponent implements OnInit {
  nombreCorto = '';
  saludo      = 'Hola';
  frase       = '';
  fechaFormateada = '';

  private frases = [
    'Que tengas un día dulce y productivo.',
    'La pastelería está lista para una jornada deliciosa.',
    'Hoy es un buen día para hornear sonrisas.',
    'Cada cliente atendido es un postre bien servido.',
    'A trabajar con la receta del éxito.'
  ];

  ngOnInit() {
    try {
      const u = JSON.parse(localStorage.getItem('usuario_sgiv') || '{}');
      this.nombreCorto = (u.nombre_completo || '').split(' ')[0] || 'colega';
    } catch { this.nombreCorto = 'colega'; }

    const h = new Date().getHours();
    if (h < 12)      this.saludo = 'Buenos días';
    else if (h < 19) this.saludo = 'Buenas tardes';
    else             this.saludo = 'Buenas noches';

    this.frase = this.frases[Math.floor(Math.random() * this.frases.length)];

    const opts: Intl.DateTimeFormatOptions = { weekday:'long', day:'numeric', month:'long', year:'numeric' };
    this.fechaFormateada = new Date().toLocaleDateString('es-BO', opts)
      .replace(/^./, c => c.toUpperCase());
  }
}
