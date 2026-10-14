import { Injectable } from '@angular/core';
import { ESTILOS_TICKET } from '../../features/shared/ticket/ticket.estilos';

// ─── Impresión del ticket ───
// Se imprime en un iframe oculto que solo contiene el ticket: no sale el resto de la
// pantalla y el tamaño de página sigue el ancho elegido en Ajustes → Parámetros.
@Injectable({ providedIn: 'root' })
export class ImpresionService {

  imprimirTicket(contenedor: HTMLElement | null | undefined, ancho: string) {
    const ticket = contenedor?.querySelector('.tk');
    if (!ticket) return;

    const pagina = ancho === 'A4' ? 'size: A4; margin: 15mm;' : `size: ${ancho}mm auto; margin: 0;`;
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(marco);

    const doc = marco.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title>
      <style>@page { ${pagina} } html, body { margin: 0; background: #fff; } ${ESTILOS_TICKET}</style>
      </head><body>${ticket.outerHTML}</body></html>`);
    doc.close();

    // Espera a que cargue el logo (si hay) antes de imprimir
    const imagenes = Array.from(doc.images);
    Promise.all(imagenes.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })))
      .then(() => {
        const ventana = marco.contentWindow!;
        ventana.focus();
        ventana.print();
        setTimeout(() => marco.remove(), 1000);
      });
  }
}
