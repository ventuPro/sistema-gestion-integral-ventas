const notificacionModel = require('../models/notificacionModel');

// ─── Notificaciones del usuario en sesión ───

const listar = async (req, res) => {
    try {
        res.json(await notificacionModel.listar(req.usuario.id_usuario, { soloNoLeidas: req.query.no_leidas === '1' }));
    } catch (e) {
        console.error('listarNotificaciones:', e);
        res.status(500).json({ error: 'No se pudieron cargar las notificaciones' });
    }
};

// body.ids: las indicadas; sin ids, todas
const marcarLeidas = async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (ids && !ids.length) return res.status(400).json({ error: 'Sin notificaciones para marcar' });
    try {
        await notificacionModel.marcarLeidas(req.usuario.id_usuario, ids);
        res.json(await notificacionModel.listar(req.usuario.id_usuario));
    } catch (e) {
        console.error('marcarLeidas:', e);
        res.status(500).json({ error: 'No se pudieron marcar como leídas' });
    }
};

module.exports = { listar, marcarLeidas };
