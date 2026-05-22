import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule,
         ShoppingCart, Wallet, Receipt,
         LayoutDashboard, ArrowRight, Sparkles } from 'lucide-angular';

@Component({
  selector: 'app-sin-acceso',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="relative w-full h-full overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 rounded-2xl">

      <div class="absolute -top-24 -right-24 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl"></div>
      <div class="absolute -bottom-24 -left-24 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl"></div>
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-sky-200/20 rounded-full blur-3xl"></div>

      <div class="relative flex flex-col items-center justify-center h-full px-6 py-12 text-center">

        <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-lg shadow-blue-200 mb-5">
          <lucide-icon [img]="icons.dashboard" class="w-10 h-10"></lucide-icon>
        </div>

        <div class="inline-flex items-center gap-1.5 bg-white/80 backdrop-blur border border-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-semibold mb-3 shadow-sm">
          <lucide-icon [img]="icons.sparkles" class="w-3.5 h-3.5"></lucide-icon>
          {{ saludo }}, {{ nombreCorto }}
        </div>

        <h1 class="text-4xl md:text-5xl font-black text-slate-800 mb-3 leading-tight">
          Bienvenido a <span class="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Pastelería Ricky's</span>
        </h1>

        <p class="text-slate-500 max-w-md text-sm md:text-base mb-2">
          {{ frase }}
        </p>
        <p class="text-xs text-slate-400 mb-8">{{ fechaFormateada }}</p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-2xl w-full">

          <div class="group bg-white/80 backdrop-blur border border-blue-100 hover:border-blue-300 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
            <div class="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mb-2 mx-auto group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <lucide-icon [img]="icons.cart" class="w-5 h-5"></lucide-icon>
            </div>
            <p class="text-xs font-bold text-slate-700">Toma pedidos</p>
            <p class="text-[11px] text-slate-500 mt-0.5">desde Mesas o POS</p>
          </div>

          <div class="group bg-white/80 backdrop-blur border border-indigo-100 hover:border-indigo-300 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
            <div class="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center mb-2 mx-auto group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <lucide-icon [img]="icons.wallet" class="w-5 h-5"></lucide-icon>
            </div>
            <p class="text-xs font-bold text-slate-700">Registra ventas</p>
            <p class="text-[11px] text-slate-500 mt-0.5">en Punto de Venta</p>
          </div>

          <div class="group bg-white/80 backdrop-blur border border-sky-100 hover:border-sky-300 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
            <div class="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center mb-2 mx-auto group-hover:bg-sky-600 group-hover:text-white transition-colors">
              <lucide-icon [img]="icons.receipt" class="w-5 h-5"></lucide-icon>
            </div>
            <p class="text-xs font-bold text-slate-700">Cierra tu caja</p>
            <p class="text-[11px] text-slate-500 mt-0.5">al fin del turno</p>
          </div>
        </div>

        <p class="mt-8 text-xs text-slate-400 inline-flex items-center gap-1.5">
          <lucide-icon [img]="icons.arrow" class="w-3.5 h-3.5"></lucide-icon>
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

  readonly icons = {
    dashboard: LayoutDashboard,
    cart:      ShoppingCart,
    wallet:    Wallet,
    receipt:   Receipt,
    arrow:     ArrowRight,
    sparkles:  Sparkles
  };

  private frases = [
    'Que tengas un día productivo y enfocado.',
    'Atiende con la calidad que nos caracteriza.',
    'Cada cliente bien atendido es un cliente que vuelve.',
    'Trabaja con orden y precisión en cada venta.',
    'Hoy es un buen día para superar las metas del turno.'
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
