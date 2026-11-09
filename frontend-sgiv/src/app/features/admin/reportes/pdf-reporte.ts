import { AjustesService } from '../../../core/services/ajustes.service';
import { fechaLarga, hora } from '../../../core/utils/informe';
import { estiloTabla } from '../../../core/utils/pdf-tabla';

// ─── PDF de los reportes (mismo estilo que el informe de ventas) ───
// jspdf se carga recién al exportar.

export interface PdfReporte {
  doc: any;
  seccion: (titulo: string) => void;
  tabla: (head: string[], body: any[][], derecha?: number[], opciones?: any) => void;
  guardar: (archivo: string) => void;
}

/** lineas: datos bajo el título (período, sucursal…). horizontal: hoja apaisada (tablas anchas) */
export const nuevoPdf = async (ajustes: AjustesService, titulo: string, lineas: string[], horizontal = false): Promise<PdfReporte> => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc: any = new jsPDF({ orientation: horizontal ? 'landscape' : 'portrait' });
  const ancho = doc.internal.pageSize.getWidth(), alto = doc.internal.pageSize.getHeight();
  const der = ancho - 14;
  const color = ajustes.colorPrimarioRgb();
  const nombre = ajustes.nombre();

  const logo = await ajustes.logoComoDataUri();
  let x = 14;
  if (logo) {
    try { doc.addImage(logo, 14, 10, 16, 16, undefined, 'FAST'); x = 34; } catch { /* formato no soportado */ }
  }
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(nombre, x, 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(100, 116, 139);
  doc.text(titulo, x, 23);
  doc.text(`Generado: ${fechaLarga(new Date())} ${hora(new Date())}`, der, 17, { align: 'right' });
  doc.setDrawColor(...color); doc.setLineWidth(0.8); doc.line(14, 30, der, 30);
  doc.setFontSize(9); doc.setTextColor(51, 65, 85);
  lineas.forEach((l, i) => doc.text(l, 14, 37 + i * 5));

  let y = 37 + lineas.length * 5 + 2;
  const seccion = (t: string) => {
    y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : y;
    if (y > alto - 40) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...color);
    doc.text(t, 14, y);
    y += 3;
  };
  const tabla = (head: string[], body: any[][], derecha: number[] = [], opciones: any = {}) => {
    autoTable(doc, estiloTabla(derecha, {
      startY: doc.lastAutoTable ? Math.max(y, doc.lastAutoTable.finalY + 2) : y,
      head: [head], body, ...opciones
    }));
  };
  const guardar = (archivo: string) => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
      doc.text(`${nombre} · ${titulo}`, 14, alto - 8);
      doc.text(`Página ${i} de ${total}`, der, alto - 8, { align: 'right' });
    }
    doc.save(archivo);
  };
  return { doc, seccion, tabla, guardar };
};

/** Nombre del negocio apto para archivo: "Pastelería Ricky's" → "Pasteleria_Rickys" */
export const nombreArchivo = (ajustes: AjustesService) =>
  ajustes.nombre().normalize('NFD').replace(/\p{M}|'/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Negocio';
