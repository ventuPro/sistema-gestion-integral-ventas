const dbAuditoria = require('../config/dbAuditoria');
const contexto    = require('./contexto');

// ─── Registro de cada petición a la API ───
// La petición se registra ANTES de ejecutarse: si la auditoría no responde,
// se rechaza con 503. Al terminar se completa su resultado (estado, duración).
const limpiarIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

const eventoPorEstado = (estado) =>
    estado === 401 ? 'SESION_INVALIDA'
  : estado === 403 ? 'ACCESO_DENEGADO'
  : estado >= 500  ? 'ERROR_SERVIDOR'
  : 'PETICION';

/** Para eventos propios (inicio de sesión, cierre, etc.). */
const marcarEvento = (res, evento, detalle = null) => { res.locals.auditoria = { evento, detalle }; };

const registrarAcceso = async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const inicio = Date.now();
    const ctx = { ip: limpiarIp(req.ip), origen: `${req.method} ${req.originalUrl.split('?')[0]}` };
    if (req.originalUrl.startsWith('/api/menu')) ctx.usuario = 'Cliente (menú QR)';

    try {
        const r = await dbAuditoria.query(
            `INSERT INTO registro_acceso (metodo, ruta, ip, agente_usuario)
             VALUES ($1, $2, $3, $4) RETURNING id_acceso`,
            [req.method, req.originalUrl, ctx.ip, req.get('user-agent') || null]);
        ctx.id_acceso = r.rows[0].id_acceso;
    } catch (e) {
        console.error('❌ Auditoría no disponible:', e.message);
        return res.status(503).json({ error: 'El registro de auditoría no está disponible. Intente más tarde.' });
    }

    let completado = false;
    const completar = () => {
        if (completado) return;
        completado = true;
        const estado = res.headersSent ? res.statusCode : 499;   // 499: el cliente cortó la conexión
        const marca  = res.locals.auditoria || {};
        dbAuditoria.query(
            `UPDATE registro_acceso
             SET estado_http = $2, duracion_ms = $3, evento = $4, id_usuario = $5, usuario = $6, detalle = $7
             WHERE id_acceso = $1`,
            [ctx.id_acceso, estado, Date.now() - inicio, marca.evento || eventoPorEstado(estado),
             ctx.id_usuario ?? null, ctx.usuario ?? null, marca.detalle ?? null]
        ).catch(e => console.error('Auditoría (completar acceso):', e.message));
    };
    res.on('finish', completar);
    res.on('close',  completar);

    contexto.ejecutar(ctx, next);
};

module.exports = { registrarAcceso, marcarEvento };
