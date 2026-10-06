const jwt = require('jsonwebtoken');
const db  = require('../config/db');
const permisoModel = require('../models/permisoModel');
const { JWT_SECRET, JWT_ALGORITMOS } = require('../config/seguridad');

// ─── Verificación de token ───
// Además de validar la firma, se consulta el usuario en la BD en cada petición:
// si fue desactivado (o eliminado) el token deja de servir de inmediato, y el rol
// y la sucursal se toman siempre de la BD (un cambio de rol aplica sin re-login).
// 401 = sesión no válida (el frontend cierra la sesión); 403 = sin permiso.
const verificarToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token      = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ mensaje: 'Acceso denegado. Sin token.' });

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET, { algorithms: JWT_ALGORITMOS });
    } catch {
        return res.status(401).json({ mensaje: 'Token inválido o expirado.' });
    }

    try {
        const r = await db.query(
            `SELECT id_usuario, id_rol, id_sucursal, estado_activo FROM usuario WHERE id_usuario = $1`,
            [payload.id_usuario]
        );
        const u = r.rows[0];
        if (!u || !u.estado_activo)
            return res.status(401).json({ mensaje: 'Usuario desactivado. Inicie sesión nuevamente.' });

        req.usuario = { ...payload, id_rol: u.id_rol, id_sucursal: u.id_sucursal };
        next();
    } catch (error) {
        console.error('Error en verificarToken:', error);
        return res.status(500).json({ mensaje: 'Error verificando la sesión' });
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