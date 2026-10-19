// ─── Fotos de productos: se reducen en el navegador antes de subirlas ───
// Una foto de celular (3–5 MB) queda en ~60–120 KB: el menú QR carga rápido y el servidor casi no se llena.

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_ORIGINAL = 20 * 1024 * 1024;

/** Devuelve un data URI WebP (JPEG si el navegador no codifica WebP) con el lado mayor ≤ `lado` px */
export async function comprimirImagen(archivo: File, lado = 800, calidad = 0.82): Promise<string> {
  if (!TIPOS.includes(archivo.type)) throw new Error('Formato no permitido. Use JPG, PNG o WEBP.');
  if (archivo.size > MAX_ORIGINAL) throw new Error('La imagen supera 20 MB.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(archivo);
  } catch {
    throw new Error('El archivo no es una imagen válida.');
  }
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const webp = canvas.toDataURL('image/webp', calidad);
  if (webp.startsWith('data:image/webp')) return webp;
  // Sin WebP (Safari antiguo): JPEG sobre fondo blanco para no perder transparencias en negro
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', calidad);
}
