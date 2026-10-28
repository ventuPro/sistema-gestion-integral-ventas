import { Chart, BarController, LineController, BarElement, LineElement, PointElement,
         CategoryScale, LinearScale, Tooltip, Filler } from 'chart.js';

// ─── Chart.js con solo las piezas que usan Panel e Informes (barras y líneas) ───
Chart.register(BarController, LineController, BarElement, LineElement, PointElement,
               CategoryScale, LinearScale, Tooltip, Filler);
Chart.defaults.font.family = "'Atkinson Hyperlegible Next Variable', ui-sans-serif, system-ui, sans-serif";

export { Chart };
