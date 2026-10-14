// ─── Actualización periódica ───
// Ejecuta fn cada ms solo mientras la pestaña está visible; al volver a ella, actualiza
// en el acto. Evita consultas (y registros de auditoría) de pantallas que nadie mira.
// Devuelve la función para detenerla.
export function sondeo(fn: () => void, ms: number): () => void {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  const alVolver = () => { if (!document.hidden) fn(); };
  document.addEventListener('visibilitychange', alVolver);
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
}
