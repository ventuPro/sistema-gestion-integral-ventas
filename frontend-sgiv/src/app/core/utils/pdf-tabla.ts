// ─── Tablas de los PDF: cuadrícula bien marcada y letra legible al imprimir ───
// Cada celda con su borde (se ve a qué columna pertenece cada dato) y los títulos
// alineados como sus datos (los números a la derecha).

/** derecha: columnas con números. opciones: lo propio de cada tabla (startY, columnStyles, didParseCell…) */
export const estiloTabla = (derecha: number[] = [], opciones: any = {}) => {
  const columnas: any = {};
  derecha.forEach(i => columnas[i] = { halign: 'right' });
  const propio = opciones.didParseCell;
  return {
    theme: 'grid',
    margin: { left: 14, right: 14 },
    ...opciones,
    styles: { fontSize: 9.5, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, valign: 'middle',
              textColor: [30, 41, 59], lineColor: [100, 116, 139], lineWidth: 0.25, ...(opciones.styles || {}) },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold',
                  lineColor: [71, 85, 105], lineWidth: 0.3, ...(opciones.headStyles || {}) },
    alternateRowStyles: { fillColor: [248, 250, 252], ...(opciones.alternateRowStyles || {}) },
    columnStyles: { ...columnas, ...(opciones.columnStyles || {}) },
    didParseCell: (c: any) => {
      if (c.section === 'head') {
        const alinear = opciones.columnStyles?.[c.column.index]?.halign ?? columnas[c.column.index]?.halign;
        if (alinear) c.cell.styles.halign = alinear;
      }
      propio?.(c);
    }
  };
};
