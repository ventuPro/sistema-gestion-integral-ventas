const permisoModel = require('../models/permisoModel');

// GET /api/permisos/mis-permisos — para el usuario logueado
const getMisPermisos = async (req, res) => {
    try {
        const { id_usuario, id_rol } = req.usuario;
        const permisos = await permisoModel.obtenerPermisosEfectivos(id_usuario, id_rol);
        res.json({ permisos });
    } catch (e) {
        console.error('Error en getMisPermisos:', e);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
};

// GET /api/permisos/usuario/:id — para que el admin vea/edite permisos
const getPermisosUsuario = async (req, res) => {
    try {
        if (req.usuario.id_rol !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede ver esto' });

        const { id } = req.params;

        // Obtener rol del usuario
        const db = require('../config/db');
        const resUser = await db.query(
            `SELECT id_rol FROM usuario WHERE id_usuario = $1`, [id]
        );
        const id_rol = resUser.rows[0]?.id_rol;

        const permisos = await permisoModel.obtenerPermisosUsuario(id, id_rol);
        res.json({ permisos });
    } catch (e) {
        console.error('Error en getPermisosUsuario:', e);
        res.status(500).json({ error: 'Error al obtener permisos del usuario' });
    }
};

// PUT /api/permisos/usuario/:id — guardar permisos
const putPermisosUsuario = async (req, res) => {
    try {
        if (req.usuario.id_rol !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede hacer esto' });

        const { id }      = req.params;
        const { permisos } = req.body;

        const resultado = await permisoModel.guardarPermisosUsuario(id, permisos);
        res.json({ mensaje: 'Permisos guardados', permisos: resultado });
    } catch (e) {
        console.error('Error en putPermisosUsuario:', e);
        res.status(500).json({ error: 'Error al guardar permisos' });
    }
};

module.exports = { getMisPermisos, getPermisosUsuario, putPermisosUsuario };