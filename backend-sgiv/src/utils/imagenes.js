const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── Imágenes subidas (productos, logo, favicon, QR de cobro) ───
// Se guardan como archivos; la BD solo guarda la ruta /uploads/<carpeta>/<archivo>.
const RAIZ = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// Solo mapas de bits (un SVG puede llevar scripts); se verifica el contenido real, no solo el tipo declarado
const FIRMAS = {
    png:  (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpg:  (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
    ico:  (b) => b.readUInt32BE(0) === 0x00000100
};
const TIPOS = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
    'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico'
};
const RUTA = /^\/uploads\/(productos|empresa)\/[\w.-]+$/;

/** Guarda un data URI; lanza Error con mensaje para el usuario si no es válido */
function guardarImagen(dataUri, { carpeta, prefijo, maxBytes, formatos = ['png', 'jpg', 'webp', 'ico'] }) {
    const m = String(dataUri || '').match(/^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=]+)$/i);
    const ext = m && TIPOS[m[1].toLowerCase()];
    const nombres = formatos.map(f => f.toUpperCase()).join(', ');
    if (!ext || !formatos.includes(ext)) throw new Error(`Formato no permitido. Use ${nombres}.`);

    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length < 12 || !FIRMAS[ext](buffer)) throw new Error(`El archivo no es una imagen ${nombres} válida.`);
    if (buffer.length > maxBytes)
        throw new Error(`La imagen supera el máximo de ${Math.round(maxBytes / 1024)} KB.`);

    const dir = path.join(RAIZ, carpeta);
    fs.mkdirSync(dir, { recursive: true });
    const archivo = `${prefijo}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, archivo), buffer);
    return `/uploads/${carpeta}/${archivo}`;
}

/** Borra el archivo de una ruta /uploads/...; ignora rutas ajenas o archivos que ya no están */
function borrarImagen(url) {
    if (!url || !RUTA.test(url)) return;
    fs.promises.unlink(path.join(RAIZ, url.slice('/uploads/'.length)))
        .catch(e => { if (e.code !== 'ENOENT') console.error('No se pudo borrar la imagen', url, e.message); });
}

/** Al arrancar: borra los archivos que ya no usa ningún producto ni Ajustes (con más de 1 h, por seguridad) */
async function limpiarHuerfanas(db) {
    const r = await db.query(`
        SELECT url_imagen AS url FROM producto WHERE url_imagen LIKE '/uploads/%'
        UNION SELECT unnest(ARRAY[url_logo, url_favicon, url_qr_cobro]) FROM configuracion`);
    const usadas = new Set(r.rows.map(x => x.url).filter(Boolean));
    const limite = Date.now() - 60 * 60 * 1000;
    let borradas = 0;
    for (const carpeta of ['productos', 'empresa']) {
        const dir = path.join(RAIZ, carpeta);
        if (!fs.existsSync(dir)) continue;
        for (const archivo of fs.readdirSync(dir)) {
            const ruta = path.join(dir, archivo);
            if (usadas.has(`/uploads/${carpeta}/${archivo}`) || fs.statSync(ruta).mtimeMs > limite) continue;
            fs.unlinkSync(ruta);
            borradas++;
        }
    }
    return borradas;
}

module.exports = { RAIZ, guardarImagen, borrarImagen, limpiarHuerfanas };
