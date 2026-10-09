const fs   = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'productos');

function guardarBase64ComoArchivo(dataUri) {
    const matches = dataUri.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-.+]+);base64,(.+)$/);
    if (!matches) throw new Error('Formato de imagen base64 inválido');

    const mimeType  = matches[1];
    const data      = matches[2];
    const ext       = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const filename  = `prod_${Date.now()}.${ext}`;
    const filepath  = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
    return `/uploads/productos/${filename}`;
}

// ─── Imágenes de Ajustes (logo, favicon) ───
// Solo formatos de mapa de bits: un SVG puede llevar scripts.
const TIPOS_IMAGEN = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico'
};

function guardarImagen(dataUri, { carpeta, prefijo, maxBytes }) {
    const m = String(dataUri || '').match(/^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=]+)$/i);
    const ext = m && TIPOS_IMAGEN[m[1].toLowerCase()];
    if (!ext) throw new Error('Formato no permitido. Use PNG, JPG, WEBP o ICO.');

    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > maxBytes)
        throw new Error(`La imagen supera el máximo de ${Math.round(maxBytes / 1024)} KB.`);

    const dir = path.join(__dirname, '..', '..', 'uploads', carpeta);
    fs.mkdirSync(dir, { recursive: true });
    const archivo = `${prefijo}_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, archivo), buffer);
    return `/uploads/${carpeta}/${archivo}`;
}

module.exports = { guardarBase64ComoArchivo, guardarImagen };
