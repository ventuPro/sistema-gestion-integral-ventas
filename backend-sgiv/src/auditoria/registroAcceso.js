const crypto      = require('crypto');
const dbAuditoria = require('../config/dbAuditoria');
const contexto    = require('./contexto');
const { leerToken } = require('../config/seguridad');

// ─── Registro de cada petición a la API ───
// La petición se registra ANTES de ejecutarse: si la auditoría no responde,
// se rechaza con 503. Al terminar se completa su resultado (estado, duración).
// Las consultas GET exitosas repetidas (misma sesión, IP, navegador y ruta,
// dentro de 10 minutos) suman una repetición a la fila anterior.
const limpiarIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

const eventoPorEstado = (estado) =>
    estado === 401 ? 'SESION_INVALIDA'
  : estado === 403 ? 'ACCESO_DENEGADO'
  : estado >= 500  ? 'ERROR_SERVIDOR'
  : 'PETICION';

const esExitosa = (estado) => estado >= 200 && estado < 400;

// Identifica la sesión sin guardar el token
const huellaSesion = (token) => token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16) : null;

const sumarRepeticion = async ({ ruta, ip, agente, sesion }) => {
    const r = await dbAuditoria.query(
        `UPDATE registro_acceso SET repeticiones = repeticiones + 1, fecha_hora_ultima = clock_timestamp()
         WHERE id_acceso = (
             SELECT id_acceso FROM registro_acceso
             WHERE metodo = 'GET' AND ruta = $1 AND fecha_hora > clock_timestamp() - interval '10 minutes'
               AND ip IS NOT DISTINCT FROM $2 AND agente_usuario IS NOT DISTINCT FROM $3
               AND sesion IS NOT DISTINCT FROM $4
               AND evento = 'PETICION' AND estado_http BETWEEN 200 AND 399
             ORDER BY id_acceso DESC LIMIT 1)
         RETURNING id_acceso`,
        [ruta, ip, agente, sesion]);
    return r.rows[0]?.id_acceso ?? null;
};

/** Para eventos propios (inicio de sesión, cierre, etc.). */
const marcarEvento = (res, evento, detalle = null) => { res.locals.auditoria = { evento, detalle }; };

const registrarAcceso = async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const inicio = Date.now();
    const ctx = { ip: limpiarIp(req.ip), origen: `${req.method} ${req.originalUrl.split('?')[0]}` };
    if (req.originalUrl.startsWith('/api/menu')) ctx.usuario = 'Cliente (menú QR)';

    const datos = { ruta: req.originalUrl, ip: ctx.ip, agente: req.get('user-agent') || null,
                    sesion: huellaSesion(leerToken(req)) };
    let agrupada = false;
    try {
        if (req.method === 'GET') ctx.id_acceso = await sumarRepeticion(datos);
        agrupada = !!ctx.id_acceso;
        if (!agrupada) {
            const r = await dbAuditoria.query(
                `INSERT INTO registro_acceso (metodo, ruta, ip, agente_usuario, sesion)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id_acceso`,
                [req.method, datos.ruta, datos.ip, datos.agente, datos.sesion]);
            ctx.id_acceso = r.rows[0].id_acceso;
        }
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
        const evento = marca.evento || eventoPorEstado(estado);
        if (agrupada) {
            if (esExitosa(estado) && evento === 'PETICION') return;
            // Ya contada en la fila agrupada; si falló queda además en su propia fila
            dbAuditoria.query(
                `INSERT INTO registro_acceso (fecha_hora, metodo, ruta, ip, agente_usuario, sesion, estado_http,
                                              duracion_ms, evento, id_usuario, usuario, detalle)
                 VALUES ($1, 'GET', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [new Date(inicio), datos.ruta, datos.ip, datos.agente, datos.sesion, estado, Date.now() - inicio, evento,
                 ctx.id_usuario ?? null, ctx.usuario ?? null, { ...(marca.detalle || {}), contada_en: ctx.id_acceso }]
            ).catch(e => console.error('Auditoría (acceso agrupado):', e.message));
            return;
        }
        dbAuditoria.query(
            `UPDATE registro_acceso
             SET estado_http = $2, duracion_ms = $3, evento = $4, id_usuario = $5, usuario = $6, detalle = $7
             WHERE id_acceso = $1`,
            [ctx.id_acceso, estado, Date.now() - inicio, evento,
             ctx.id_usuario ?? null, ctx.usuario ?? null, marca.detalle ?? null]
        ).catch(e => console.error('Auditoría (completar acceso):', e.message));
    };
    res.on('finish', completar);
    res.on('close',  completar);

    contexto.ejecutar(ctx, next);
};

module.exports = { registrarAcceso, marcarEvento, huellaSesion };
