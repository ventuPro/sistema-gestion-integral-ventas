const crypto = require('crypto');
const db = require('../config/db');
const { JWT_SECRET } = require('../config/seguridad');

// ─── Mesa habilitada (estado 'Ocupada') ───
// Se habilita sola al confirmar el primer pedido o al abrir la cuenta, o a mano.
// q = db o un cliente de una transacción

const habilitar = (q, id_mesa) => q.query(`
    UPDATE mesa_local
    SET estado_mesa = 'Ocupada',
        fecha_habilitacion = CASE WHEN estado_mesa = 'Ocupada' AND fecha_habilitacion IS NOT NULL
                                  THEN fecha_habilitacion ELSE NOW() END,
        codigo_visita = COALESCE(codigo_visita, $2)
    WHERE id_mesa = $1
    RETURNING id_mesa, numero_mesa, id_sucursal, codigo_visita
`, [id_mesa, crypto.randomBytes(16).toString('hex')]);

// Las visitas que empezaron antes terminan y el QR temporal deja de servir
const liberar = (q, id_mesa) => q.query(`
    UPDATE mesa_local
    SET estado_mesa = 'Libre', fecha_habilitacion = NULL, codigo_visita = NULL, fecha_liberacion = NOW()
    WHERE id_mesa = $1
`, [id_mesa]);

// Habilitadas hace más de `horas` y sin cuenta abierta (nadie pidió nada)
const liberarVencidas = async (horas) => (await db.query(`
    UPDATE mesa_local m
    SET estado_mesa = 'Libre', fecha_habilitacion = NULL, codigo_visita = NULL, fecha_liberacion = NOW()
    WHERE m.estado_mesa = 'Ocupada'
      AND m.fecha_habilitacion < NOW() - make_interval(hours => $1)
      AND NOT EXISTS (SELECT 1 FROM cuenta_mesa c WHERE c.id_mesa = m.id_mesa AND c.estado = 'Abierta')
    RETURNING m.id_mesa, m.id_sucursal
`, [horas])).rows;

// ─── Visita: dato firmado que guarda el celular (no se escribe en la BD) ───
// m = mesa, c = celular, i = inicio, a = última actividad, v = código del QR temporal

const CLAVE = crypto.createHmac('sha256', JWT_SECRET).update('visita-menu').digest();
const firma = (datos) => crypto.createHmac('sha256', CLAVE).update(datos).digest('base64url');

const firmar = ({ m, c, i, a = Date.now(), v = null }) => {
    const datos = Buffer.from(JSON.stringify({ m, c, i, a, v })).toString('base64url');
    return `${datos}.${firma(datos)}`;
};

const leer = (token) => {
    const [datos, f] = String(token || '').split('.');
    if (!datos || !f) return null;
    const esperada = Buffer.from(firma(datos)), recibida = Buffer.from(f);
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
    try { return JSON.parse(Buffer.from(datos, 'base64url').toString()); } catch { return null; }
};

/**
 * Revisa la visita de un celular en la mesa.
 * motivo: 'vencida' (tiempo o inactividad), 'terminada' (se liberó la mesa), 'sin_qr_visita' (falta el ticket)
 */
const revisar = (token, mesa, p, ahora = Date.now()) => {
    const t = leer(token);
    if (!t || t.m !== mesa.id_mesa) return { valida: false, motivo: 'vencida' };
    if (ahora - t.i > p.menu_visita_horas * 3600_000 || ahora - t.a > p.menu_visita_inactividad * 60_000)
        return { valida: false, motivo: 'vencida', datos: t };
    if (mesa.fecha_liberacion && new Date(mesa.fecha_liberacion).getTime() > t.i)
        return { valida: false, motivo: 'terminada', datos: t };
    if (p.menu_qr_visita && (!t.v || t.v !== mesa.codigo_visita))
        return { valida: false, motivo: 'sin_qr_visita', datos: t };
    return { valida: true, datos: t };
};

// ─── Bloqueos por pedido falso ───

const estaBloqueado = async (q, id_mesa, cliente_mesa, ip) =>
    (await q.query(`
        SELECT 1 FROM bloqueo_menu
        WHERE id_mesa = $1 AND bloqueado_hasta > NOW()
          AND ((cliente_mesa IS NOT NULL AND cliente_mesa = $2) OR (ip_cliente IS NOT NULL AND ip_cliente = $3))
        LIMIT 1
    `, [id_mesa, cliente_mesa, ip])).rows.length > 0;

const bloquear = (q, { pedido, id_usuario, horas }) => q.query(`
    INSERT INTO bloqueo_menu (id_mesa, cliente_mesa, ip_cliente, id_pedido, id_usuario, bloqueado_hasta)
    VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(hours => $6))
`, [pedido.id_mesa, pedido.cliente_mesa, pedido.ip_cliente, pedido.id_pedido, id_usuario, horas]);

module.exports = { habilitar, liberar, liberarVencidas, firmar, leer, revisar, estaBloqueado, bloquear };
