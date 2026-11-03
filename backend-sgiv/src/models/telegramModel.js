const db = require('../config/db');
const telegram = require('../utils/telegram');

// ─── Telegram por usuario ───
// El administrador registra el teléfono (Ajustes → Telegram); la persona abre el bot y comparte su
// número: si coincide, queda vinculada (telegram_chat_id). Recibe los avisos de avisos_sucursal
// (NULL = todas) y el código de cada inicio de sesión.

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

const listar = async () => (await db.query(`
    SELECT u.id_usuario, u.nombre_completo, u.id_rol, r.nombre_rol, u.id_sucursal, s.nombre_sucursal,
           u.telefono, (u.telegram_chat_id IS NOT NULL) AS vinculado, u.avisos_telegram, u.avisos_sucursal
    FROM usuario u
    LEFT JOIN rol_usuario r ON r.id_rol = u.id_rol
    LEFT JOIN sucursal s ON s.id_sucursal = u.id_sucursal
    WHERE u.estado_activo = TRUE
    ORDER BY u.id_rol, u.nombre_completo`)).rows;

/** Cambiar el teléfono desvincula (la nueva persona debe compartir su número) */
const actualizar = async (id_usuario, { telefono, avisos_telegram, avisos_sucursal }) => {
    const tel = telegram.normalizarTelefono(telefono);
    if (telefono && (!tel || tel.length < 8 || tel.length > 15)) throw error('INVALIDO', 'El teléfono no es válido');
    try {
        const r = await db.query(`
            UPDATE usuario SET
                telegram_chat_id = CASE WHEN telefono IS NOT DISTINCT FROM $2 THEN telegram_chat_id END,
                telefono = $2, avisos_telegram = $3, avisos_sucursal = $4
            WHERE id_usuario = $1 AND estado_activo = TRUE
            RETURNING id_usuario`, [id_usuario, tel, avisos_telegram !== false, avisos_sucursal || null]);
        if (!r.rows.length) throw error('NO_EXISTE', 'Usuario no encontrado');
    } catch (e) {
        if (e.code === '23505') {
            const otro = (await db.query(`SELECT nombre_completo FROM usuario WHERE telefono = $1`, [tel])).rows[0];
            throw error('OCUPADO', `Ese teléfono ya lo tiene ${otro?.nombre_completo || 'otro usuario'}`);
        }
        if (e.code === '23503') throw error('INVALIDO', 'Sucursal no encontrada');
        throw e;
    }
};

const desvincular = (id_usuario) =>
    db.query(`UPDATE usuario SET telegram_chat_id = NULL WHERE id_usuario = $1`, [id_usuario]);

/** El chat compartió su propio número: lo vincula con el usuario de ese teléfono */
const vincular = async (telefono, chat_id) => {
    const tel = telegram.normalizarTelefono(telefono);
    if (!tel) return null;
    const cliente = await db.connect();
    try {
        await cliente.query('BEGIN');
        // Un chat es de una sola persona
        await cliente.query(`UPDATE usuario SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND telefono IS DISTINCT FROM $2`,
                            [chat_id, tel]);
        const r = await cliente.query(`
            UPDATE usuario SET telegram_chat_id = $2
            WHERE telefono = $1 AND estado_activo = TRUE
            RETURNING id_usuario, nombre_completo`, [tel, chat_id]);
        await cliente.query('COMMIT');
        return r.rows[0] || null;
    } catch (e) {
        await cliente.query('ROLLBACK');
        throw e;
    } finally {
        cliente.release();
    }
};

const chatDe = async (id_usuario) =>
    (await db.query(`SELECT telegram_chat_id, telefono FROM usuario WHERE id_usuario = $1 AND estado_activo = TRUE`,
                    [id_usuario])).rows[0] || null;

/** Chats que reciben la notificación n (mismas reglas que la campana, con la sucursal elegida en Ajustes) */
const destinatarios = async (n) => (await db.query(`
    SELECT u.telegram_chat_id FROM usuario u
    WHERE u.estado_activo = TRUE AND u.telegram_chat_id IS NOT NULL AND u.avisos_telegram = TRUE
      AND u.id_usuario IS DISTINCT FROM $4
      AND (($1 = 'USUARIO' AND u.id_usuario = $3)
           OR ((u.id_rol = 1 OR $1 = 'SUCURSAL')
               AND (u.avisos_sucursal IS NULL OR $2::int IS NULL OR u.avisos_sucursal = $2)))`,
    [n.destino, n.id_sucursal, n.id_usuario, n.leida_por])).rows.map(r => r.telegram_chat_id);

module.exports = { listar, actualizar, desvincular, vincular, chatDe, destinatarios };
