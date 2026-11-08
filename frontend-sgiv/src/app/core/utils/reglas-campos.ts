// ─── Qué se puede escribir en cada campo (se instala una vez para toda la app) ───
// - type="number": solo dígitos; punto decimal salvo con step entero (step="1"); la coma pasa a punto.
// - type="tel": dígitos, espacios y + - ( )
// - [data-solo-letras]: letras, espacios y . ' -
// - [data-mayusculas]: lo escrito pasa a mayúsculas.
// - [data-regla]: filtro y formato de core/utils/validacion.ts (celular, telefono, nombre, ci…).
// Los campos de texto se limpian en el evento input (antes que ngModel), así también vale
// al pegar y con el teclado del celular.
// Al enviar un <form> o pulsar el botón [data-enter] / [data-validar] de una ventana se
// revisan sus campos: si alguno falla no se guarda y se marca en rojo con su mensaje.

import { filtrarSegunRegla, marcarCampo, validarContenedor } from './validacion';

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
  if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) return;
  if (campo.hasAttribute('aria-invalid')) queueMicrotask(() => marcarCampo(campo));
  if (campo.type === 'number') return;
  let valor = campo.value;
  if (campo.hasAttribute('data-solo-letras')) valor = valor.replace(NO_LETRAS, '').replace(/\s{2,}/g, ' ');
  if (campo.type === 'tel' && !campo.dataset['regla']) valor = valor.replace(NO_TELEFONO, '');
  valor = filtrarSegunRegla(campo, valor);
  if (campo.hasAttribute('data-mayusculas')) valor = valor.toLocaleUpperCase('es');
  if (valor === campo.value) return;
  const quitados = campo.value.length - valor.length;
  const cursor = Math.max(0, (campo.selectionStart ?? valor.length) - quitados);
  campo.value = valor;
  campo.setSelectionRange(cursor, cursor);
};

/** Al salir de un campo con algo escrito se revisa su formato */
const alSalir = (evento: FocusEvent) => {
  const campo = evento.target;
  if ((campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) && campo.value.trim()) marcarCampo(campo);
};

const alEnviar = (evento: SubmitEvent) => {
  if (!(evento.target instanceof HTMLFormElement) || validarContenedor(evento.target)) return;
  evento.preventDefault();
  evento.stopImmediatePropagation();
};

/** Botón principal fuera de un <form>: revisa los campos de su ventana */
const alPulsar = (evento: MouseEvent) => {
  const boton = (evento.target as Element | null)?.closest?.('[data-enter], [data-validar]');
  if (!boton || boton.closest('form')) return;
  const contenedor = boton.closest('[data-formulario], .ventana');
  if (!contenedor || validarContenedor(contenedor)) return;
  evento.preventDefault();
  evento.stopImmediatePropagation();
};

export const instalarReglasCampos = () => {
  document.addEventListener('beforeinput', antesDeEscribir as EventListener, true);
  document.addEventListener('input', alEscribir, true);
  document.addEventListener('focusout', alSalir, true);
  document.addEventListener('submit', alEnviar, true);
  document.addEventListener('click', alPulsar, true);
};
