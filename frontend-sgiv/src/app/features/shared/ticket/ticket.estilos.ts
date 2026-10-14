// Estilos propios (sin Tailwind): se usan en pantalla y dentro de la ventana de impresión
export const ESTILOS_TICKET = `
.tk { font-family: 'Courier New', ui-monospace, monospace; color: #000; background: #fff; line-height: 1.35; margin: 0 auto; }
.tk-58 { width: 58mm; padding: 3mm 2.5mm; font-size: 11px; }
.tk-80 { width: 80mm; padding: 4mm; font-size: 12px; }
.tk-A4 { width: 120mm; padding: 10mm 8mm; font-size: 13px; }
.tk-cabecera { text-align: center; }
.tk-logo { max-height: 14mm; max-width: 60%; margin: 0 auto 1.5mm; display: block; object-fit: contain; }
.tk-nombre { font-size: 1.3em; font-weight: 700; margin: 0; }
.tk-dato { margin: 0.4mm 0 0; font-size: 0.92em; }
.tk-linea { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
.tk-fila { display: flex; justify-content: space-between; gap: 2mm; }
.tk-fila > :first-child { overflow-wrap: anywhere; }
.tk-fila > :last-child { white-space: nowrap; text-align: right; }
.tk-item { margin-bottom: 1.2mm; }
.tk-detalle { font-size: 0.95em; padding-left: 2mm; }
.tk-total { font-size: 1.25em; font-weight: 700; }
.tk-pie { text-align: center; font-style: italic; margin-top: 4mm; }
`;
