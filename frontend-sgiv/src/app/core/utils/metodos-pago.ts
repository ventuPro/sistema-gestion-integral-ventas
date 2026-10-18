// ─── Métodos de pago (fijos; se habilitan en Ajustes → Parámetros) ───
export const METODO_PAGO = { efectivo: 'Efectivo', qr: 'QR' } as const;
export type MetodoPago = typeof METODO_PAGO[keyof typeof METODO_PAGO];
