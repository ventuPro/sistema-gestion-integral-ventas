// ─── Qué se puede escribir en cada campo (se instala una vez para toda la app) ───
// - type="number": solo dígitos; punto decimal salvo con step entero (step="1"); la coma pasa a punto.
// - type="tel": dígitos, espacios y + - ( )
// - [data-solo-letras]: letras, espacios y . ' -
// - [data-mayusculas]: lo escrito pasa a mayúsculas.
// Los campos de texto se limpian en el evento input (antes que ngModel), así también vale
// al pegar y con el teclado del celular.

const NO_LETRAS   = /[^\p{L}\s.'-]/gu;
const NO_TELEFONO = /[^\d\s+()-]/g;

const esEntero = (campo: HTMLInputElement) => {
  const paso = campo.getAttribute('step');
  return paso !== null && paso !== 'any' && Number.isInteger(Number(paso));
};

/** Números: bloquea lo que no sea dígito (o separador decimal donde se permite) */
const antesDeEscribir = (evento: InputEvent) => {
  const campo = evento.target;
  if (!(campo instanceof HTMLInputElement) || campo.type !== 'number' || !evento.data || !evento.cancelable) return;
  const decimal = !esEntero(campo);
  const limpio = evento.data.replace(',', '.').replace(decimal ? /[^\d.]/g : /\D/g, '');
  if (limpio === evento.data) return;
  evento.preventDefault();
  if (limpio) document.execCommand('insertText', false, limpio);
};

/** Texto: quita lo no permitido y pasa a mayúsculas, sin mover el cursor */
const alEscribir = (evento: Event) => {
  const campo = evento.target;
  if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) || campo.type === 'number') return;
  let valor = campo.value;
  if (campo.hasAttribute('data-solo-letras')) valor = valor.replace(NO_LETRAS, '').replace(/\s{2,}/g, ' ');
  if (campo.type === 'tel') valor = valor.replace(NO_TELEFONO, '');
  if (campo.hasAttribute('data-mayusculas')) valor = valor.toLocaleUpperCase('es');
  if (valor === campo.value) return;
  const quitados = campo.value.length - valor.length;
  const cursor = Math.max(0, (campo.selectionStart ?? valor.length) - quitados);
  campo.value = valor;
  campo.setSelectionRange(cursor, cursor);
};

export const instalarReglasCampos = () => {
  document.addEventListener('beforeinput', antesDeEscribir as EventListener, true);
  document.addEventListener('input', alEscribir, true);
};
