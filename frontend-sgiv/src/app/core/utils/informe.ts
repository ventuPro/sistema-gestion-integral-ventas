import { AjustesService } from '../services/ajustes.service';

// ─── Formato de cifras para panel e informes ───
export function cifra(n: any, decimales = 2): string {
  const v = Number(n) || 0;
  const [entero, fraccion] = Math.abs(v).toFixed(decimales).split('.');
  const grupos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '−' : '') + grupos + (fraccion ? '.' + fraccion : '');
}

export const entero = (n: any) => cifra(n, 0);

/** Variación porcentual; null si no hay base para comparar */
export function variacion(actual: any, anterior: any): number | null {
  const a = Number(actual) || 0, b = Number(anterior) || 0;
  if (b <= 0) return null;
  return (a - b) / b * 100;
}

export function porcentaje(parte: any, total: any): number {
  const t = Number(total) || 0;
  return t > 0 ? (Number(parte) || 0) / t * 100 : 0;
}

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const fechaLocal = (f: string) => new Date(f.length === 10 ? f + 'T00:00:00' : f);

export function fechaCorta(f: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(fechaLocal(f)).replace('.', '');
}

export function fechaLarga(f: string | Date): string {
  const d = typeof f === 'string' ? fechaLocal(f) : f;
  const t = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function hora(f: string | Date): string {
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hour12: false })
    .format(typeof f === 'string' ? new Date(f) : f);
}

export function fechaHora(f: string): string {
  const d = new Date(f);
  const dia = new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  return `${dia} ${hora(d)}`;
}

// ─── Colores de los gráficos: siguen Ajustes → Apariencia (color y modo oscuro) ───
export interface TemaGrafico {
  acento: string; acentoMedio: string; acentoSuave: string; fantasma: string;
  texto: string; rejilla: string; fondoTooltip: string;
  serie: string[];
}

export function temaGrafico(ajustes: AjustesService): TemaGrafico {
  const [r, g, b] = ajustes.colorPrimarioRgb();
  const oscuro = ajustes.oscuro();
  return {
    acento:       `rgb(${r}, ${g}, ${b})`,
    acentoMedio:  `rgba(${r}, ${g}, ${b}, 0.55)`,
    acentoSuave:  `rgba(${r}, ${g}, ${b}, 0.16)`,
    fantasma:     oscuro ? 'rgba(148, 163, 184, 0.28)' : 'rgba(100, 116, 139, 0.2)',
    texto:        oscuro ? '#94a3b8' : '#64748b',
    rejilla:      oscuro ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.06)',
    fondoTooltip: oscuro ? '#f1f5f9' : '#0f172a',
    serie: [`rgb(${r}, ${g}, ${b})`, '#0d9488', '#d97706', '#7c3aed', '#64748b', '#db2777']
  };
}

/** Tamaño de letra de los gráficos con la escala de letra del sistema */
const letra = (px: number) =>
  Math.round(px * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala-texto')) || 1));

/** Opciones comunes de Chart.js con el estilo del informe */
export function opcionesBase(t: TemaGrafico, formatoY: (v: number) => string): any {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.fondoTooltip,
        titleColor: t.fondoTooltip === '#0f172a' ? '#f8fafc' : '#0f172a',
        bodyColor:  t.fondoTooltip === '#0f172a' ? '#e2e8f0' : '#1e293b',
        padding: 10, cornerRadius: 6, displayColors: false,
        titleFont: { size: letra(11), weight: '600' }, bodyFont: { size: letra(12) }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t.rejilla },
        ticks: { color: t.texto, font: { size: letra(11) }, maxRotation: 0, autoSkipPadding: 8 }
      },
      y: {
        beginAtZero: true,
        grid: { color: t.rejilla },
        border: { display: false },
        ticks: { color: t.texto, font: { size: letra(11) }, maxTicksLimit: 5, callback: (v: number) => formatoY(v) }
      }
    }
  };
}
