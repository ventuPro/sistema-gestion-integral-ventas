const db  = require('../config/db');
const permisoModel = require('../models/permisoModel');
const contexto     = require('../auditoria/contexto');
const { leerToken, verificarJWT, COOKIE_SESION, opcionesCookie } = require('../config/seguridad');

// ─── Verificación de token ───
// Además de validar la firma, se consulta el usuario en la BD en cada petición:
// si fue desactivado (o eliminado) el token deja de servir de inmediato, y el rol
// y la sucursal se toman siempre de la BD (un cambio de rol aplica sin re-login).
// 401 = sesión no válida (el frontend cierra la sesión); 403 = sin permiso.
const sesionInvalida = (req, res, mensaje) => {
    res.clearCookie(COOKIE_SESION, opcionesCookie(req));
    return res.status(401).json({ mensaje });
};

const verificarToken = async (req, res, next) => {
    const token = leerToken(req);
    if (!token) return res.status(401).json({ mensaje: 'Acceso denegado. Sin sesión.' });

    const payload = verificarJWT(token);
    if (!payload) return sesionInvalida(req, res, 'Sesión inválida o expirada.');

    try {
        const r = await db.query(
            `SELECT id_usuario, id_rol, id_sucursal, estado_activo, nombre_completo, correo_electronico
             FROM usuario WHERE id_usuario = $1`,
            [payload.id_usuario]
        );
        const u = r.rows[0];
        if (!u || !u.estado_activo)
            return sesionInvalida(req, res, 'Usuario desactivado. Inicie sesión nuevamente.');

        req.usuario = { ...payload, id_rol: u.id_rol, id_sucursal: u.id_sucursal };
        contexto.asignarUsuario(u.id_usuario, `${u.nombre_completo} <${u.correo_electronico}>`);
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

const soloAdministrador = (req, res, next) =>
    Number(req.usuario?.id_rol) === 1
        ? next()
        : res.status(403).json({ error: 'Solo el administrador puede realizar esta acción' });

module.exports = { verificarToken, verificarPermiso, soloAdministrador };