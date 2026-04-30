const permisoModel = require('../models/permisoModel');
const userModel    = require('../models/userModel');

// Obtener permisos efectivos de un usuario
const obtenerPermisos = async (req, res) => {
    try {
        const { id_usuario } = req.params;

        // Buscar usuario para saber su rol
        const usuarios = await userModel.obtenerTodosLosUsuarios();
        const usuario  = usuarios.find(u => u.id_usuario == id_usuario);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

        const permisos = await permisoModel.obtenerPermisosEfectivos(id_usuario, usuario.id_rol);
        res.json({ id_usuario, permisos, modulos: permisoModel.MODULOS_SISTEMA });
    } catch (error) {
        console.error('Error obtenerPermisos:', error);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
};

// Guardar permisos de un usuario (solo admin)
const guardarPermisos = async (req, res) => {
    try {
        // Solo el Administrador puede modificar permisos
        if (req.usuario.id_rol !== 1) {
            return res.status(403).json({ error: 'Solo el Administrador puede modificar permisos' });
        }
        const { id_usuario } = req.params;
        const { permisos }   = req.body;

        if (!permisos || typeof permisos !== 'object') {
            return res.status(400).json({ error: 'Permisos inválidos' });
        }

        await permisoModel.guardarPermisosUsuario(id_usuario, permisos);
        res.json({ mensaje: 'Permisos actualizados correctamente' });
    } catch (error) {
        console.error('Error guardarPermisos:', error);
        res.status(500).json({ error: 'Error al guardar permisos' });
    }
};

// Obtener mis propios permisos (para el frontend al iniciar sesión)
const obtenerMisPermisos = async (req, res) => {
    try {
        const { id_usuario, id_rol } = req.usuario;
        const permisos = await permisoModel.obtenerPermisosEfectivos(id_usuario, id_rol);
        res.json({ permisos });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tus permisos' });
    }
};

module.exports = { obtenerPermisos, guardarPermisos, obtenerMisPermisos };