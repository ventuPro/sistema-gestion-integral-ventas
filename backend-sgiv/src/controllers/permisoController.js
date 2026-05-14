const permisoModel = require('../models/permisoModel');
const db           = require('../config/db');

const getMisPermisos = async (req, res) => {
    try {
        const { id_usuario, id_rol } = req.usuario;
        const permisos = await permisoModel.obtenerPermisosEfectivos(
            Number(id_usuario),
            Number(id_rol)
        );
        res.json({ permisos });
    } catch (e) {
        console.error('Error getMisPermisos:', e);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
};

const getPermisosUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede ver esto' });

        const id_usuario = Number(req.params.id);
        const resUser    = await db.query(
            `SELECT id_rol FROM usuario WHERE id_usuario = $1`, [id_usuario]
        );

        if (!resUser.rows[0])
            return res.status(404).json({ error: 'Usuario no encontrado' });

        const id_rol = Number(resUser.rows[0].id_rol);
        const permisos = await permisoModel.obtenerPermisosUsuario(id_usuario, id_rol);
        res.json({ permisos });
    } catch (e) {
        console.error('Error getPermisosUsuario:', e);
        res.status(500).json({ error: 'Error al obtener permisos del usuario' });
    }
};

const putPermisosUsuario = async (req, res) => {
    try {
        if (Number(req.usuario.id_rol) !== 1)
            return res.status(403).json({ error: 'Solo el administrador puede hacer esto' });

        const id_usuario = Number(req.params.id);
        const { permisos } = req.body;

        if (!permisos || typeof permisos !== 'object')
            return res.status(400).json({ error: 'Permisos inválidos' });

        const resultado = await permisoModel.guardarPermisosUsuario(id_usuario, permisos);
        res.json({ mensaje: 'Permisos guardados correctamente', permisos: resultado });
    } catch (e) {
        console.error('Error putPermisosUsuario:', e);
        res.status(500).json({ error: 'Error al guardar permisos' });
    }
};

module.exports = { getMisPermisos, getPermisosUsuario, putPermisosUsuario };