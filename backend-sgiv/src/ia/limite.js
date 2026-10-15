// ─── Límite de mensajes por clave (usuario, mesa o IP) en una ventana de tiempo ───
const crearLimite = (ventanaMs) => {
    const conteos = new Map();   // clave → { cantidad, desde }

    setInterval(() => {
        const ahora = Date.now();
        for (const [clave, r] of conteos)
            if (ahora - r.desde > ventanaMs) conteos.delete(clave);
    }, ventanaMs).unref();

    /** Suma un mensaje; true si ya pasó el máximo */
    return (clave, maximo) => {
        const r = conteos.get(clave);
        if (!r || Date.now() - r.desde > ventanaMs) {
            conteos.set(clave, { cantidad: 1, desde: Date.now() });
            return false;
        }
        r.cantidad++;
        return r.cantidad > maximo;
    };
};

module.exports = { crearLimite };
