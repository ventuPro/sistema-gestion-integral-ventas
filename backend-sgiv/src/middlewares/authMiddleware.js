const jwt = require('jsonwebtoken');
const permisoModel = require('../models/permisoModel');

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token      = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ mensaje: 'Acceso denegado. Sin token.' });

    try {
        const secret = process.env.JWT_SECRET || 'ventupro2503_Security_key';
        req.usuario  = jwt.verify(token, secret);
        next();
    } catch {
        return res.status(403).json({ mensaje: 'Token inválido o expirado.' });
    }
};

// Middleware para verificar permiso de módulo específico
const verificarPermiso = (modulo) => {
    return async (req, res, next) => {
        try {
            const { id_usuario, id_rol } = req.usuario;
            // Admin (rol 1) siempre pasa
            if (id_rol === 1) return next();

            const permisos = await permisoModel.obtenerPermisosEfectivos(id_usuario, id_rol);
            if (permisos[modulo] === true) return next();

            return res.status(403).json({ error: `Sin acceso al módulo: ${modulo}` });
        } catch (error) {
            return res.status(500).json({ error: 'Error verificando permisos' });
        }
    };
};

module.exports = { verificarToken, verificarPermiso };