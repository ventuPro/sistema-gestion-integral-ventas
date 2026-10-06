const crypto = require('crypto');
require('dotenv').config();

// ─── Secreto JWT ───
// Se lee de JWT_SECRET. Nunca se usa un valor por defecto conocido: si falta,
// se genera uno aleatorio en memoria (las sesiones se invalidan al reiniciar).
const SECRETOS_INSEGUROS = ['ventupro2503_Security_key', '123456789', 'secret', 'changeme'];

const obtenerSecretoJWT = () => {
    const secreto = (process.env.JWT_SECRET || '').trim();
    if (!secreto) {
        console.warn('⚠️  JWT_SECRET no está definido: se usa un secreto aleatorio temporal. ' +
                     'Las sesiones se cerrarán cada vez que se reinicie el servidor.');
        return crypto.randomBytes(64).toString('hex');
    }
    if (secreto.length < 32 || SECRETOS_INSEGUROS.includes(secreto)) {
        console.warn('⚠️  JWT_SECRET es débil o conocido. Genere uno con: ' +
                     'node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    }
    return secreto;
};

const JWT_SECRET    = obtenerSecretoJWT();
const JWT_OPCIONES  = { algorithm: 'HS256', expiresIn: '8h' };
const JWT_ALGORITMOS = ['HS256'];

// ─── Orígenes permitidos (CORS) ───
// Se permite:
//   1. Los orígenes listados en CORS_ORIGINS (separados por coma).
//   2. localhost y direcciones de red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x),
//      que es como se usa el sistema dentro de la pastelería.
//   3. Un frontend servido desde el mismo host que el backend (otro puerto),
//      que es como el frontend construye la URL de la API.
// Las peticiones sin cabecera Origin (Postman, curl, servidor a servidor) no son CORS.
const ORIGENES_EXTRA = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const esHostLocal = (hostname) =>
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

const origenPermitido = (origin, hostPeticion) => {
    if (!origin) return true;
    if (ORIGENES_EXTRA.includes('*') || ORIGENES_EXTRA.includes(origin)) return true;
    try {
        const { hostname } = new URL(origin);
        if (esHostLocal(hostname)) return true;
        const hostBackend = (hostPeticion || '').replace(/:\d+$/, '');
        return !!hostBackend && hostname === hostBackend;
    } catch {
        return false;
    }
};

module.exports = { JWT_SECRET, JWT_OPCIONES, JWT_ALGORITMOS, origenPermitido };
