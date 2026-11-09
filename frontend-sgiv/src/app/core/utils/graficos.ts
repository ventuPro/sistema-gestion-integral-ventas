import { Chart, BarController, LineController, PieController, BarElement, LineElement, PointElement, ArcElement,
         CategoryScale, LinearScale, Tooltip, Filler, Legend } from 'chart.js';

// ─── Chart.js con solo las piezas que usan Panel e Informes (barras, líneas, área y pizza) ───
Chart.register(BarController, LineController, PieController, BarElement, LineElement, PointElement, ArcElement,
               CategoryScale, LinearScale, Tooltip, Filler, Legend);
Chart.defaults.font.family = "'Public Sans Variable', ui-sans-serif, system-ui, sans-serif";

export { Chart };
