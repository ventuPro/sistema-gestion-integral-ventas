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

module.exports = { guardarBase64ComoArchivo };
