const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const userModel   = require('../models/userModel');
const db          = require('../config/db');
const { JWT_SECRET, JWT_OPCIONES } = require('../config/seguridad');

// Un usuario con permiso 'usuarios' que no es administrador no puede crear,
// ascender ni modificar administradores.
const esAdmin = (req) => Number(req.usuario?.id_rol) === 1;
const tocaAdmin = async (id_usuario_objetivo, id_rol_nuevo) => {
    if (Number(id_rol_nuevo) === 1) return true;
    if (!id_usuario_objetivo) return false;
    const r = await db.query(`SELECT id_rol FROM usuario WHERE id_usuario = $1`, [id_usuario_objetivo]);
    return Number(r.rows[0]?.id_rol) === 1;
};

const registrarUsuario = async (req, res) => {
    try {
        const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena } = req.body || {};
        if (!nombre_completo || !correo_electronico || !contrasena || !id_rol)
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        if (!esAdmin(req) && await tocaAdmin(null, id_rol))
            return res.status(403).json({ error: 'Solo un administrador puede crear administradores' });
        const existente = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (existente) return res.status(400).json({ error: 'El correo ya está registrado' });

        const salt           = await bcrypt.genSalt(10);
        const contrasena_hash = await bcrypt.hash(contrasena, salt);
        const nuevoUsuario   = await userModel.crearUsuario({ id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash });
        res.status(201).json({ mensaje: 'Usuario creado', usuario: nuevoUsuario });
    } catch (e) {
        console.error('Error en registrarUsuario:', e);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
};

const loginUsuario = async (req, res) => {
    try {
        const { correo_electronico, contrasena } = req.body;
        const u = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (!await bcrypt.compare(contrasena, u.contrasena_hash))
            return res.status(401).json({ error: 'Contraseña incorrecta' });

        // Obtener nombre de sucursal
        const rSuc = await require('../config/db').query(
            `SELECT nombre_sucursal FROM sucursal WHERE id_sucursal = $1`,
            [u.id_sucursal]
        );
        const nombre_sucursal = rSuc.rows[0]?.nombre_sucursal || '';

        const token = jwt.sign(
            { id_usuario: u.id_usuario, id_rol: u.id_rol, id_sucursal: u.id_sucursal },
            JWT_SECRET,
            JWT_OPCIONES
        );

        res.json({
            mensaje: 'Login exitoso',
            token,
            usuario: {
                id_usuario:      u.id_usuario,
                nombre_completo: u.nombre_completo,
                id_rol:          u.id_rol,
                id_sucursal:     u.id_sucursal,
                nombre_sucursal              // ← incluir aquí
            }
        });
    } catch(e) {
        console.error('Error loginUsuario:', e);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
};

const listarUsuarios = async (req, res) => {
    try {
        const usuarios = await userModel.listarUsuarios();
        res.json(usuarios);
    } catch (e) {
        console.error('Error en listarUsuarios:', e);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
};

const actualizarUsuario = async (req, res) => {
    try {
        if (!esAdmin(req) && await tocaAdmin(req.params.id, req.body?.id_rol))
            return res.status(403).json({ error: 'Solo un administrador puede modificar administradores' });
        const usuario = await userModel.actualizarUsuario(req.params.id, req.body);
        res.json({ mensaje: 'Usuario actualizado', usuario });
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
};

const desactivarUsuario = async (req, res) => {
    try {
        if (!esAdmin(req) && await tocaAdmin(req.params.id))
            return res.status(403).json({ error: 'Solo un administrador puede desactivar administradores' });
        if (Number(req.params.id) === Number(req.usuario.id_usuario))
            return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
        await userModel.desactivarUsuario(req.params.id);
        res.json({ mensaje: 'Usuario desactivado' });
    } catch (e) {
        res.status(500).json({ error: 'Error al desactivar usuario' });
    }
};

const reactivarUsuario = async (req, res) => {
    try {
        await userModel.reactivarUsuario(req.params.id);
        res.json({ mensaje: 'Usuario reactivado' });
    } catch (e) {
        res.status(500).json({ error: 'Error al reactivar usuario' });
    }
};

const cambiarContrasena = async (req, res) => {
    try {
        const { nueva_contrasena } = req.body || {};
        if (!nueva_contrasena || String(nueva_contrasena).length < 6)
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        if (!esAdmin(req) && await tocaAdmin(req.params.id))
            return res.status(403).json({ error: 'Solo un administrador puede cambiar esa contraseña' });
        const salt           = await bcrypt.genSalt(10);
        const contrasena_hash = await bcrypt.hash(nueva_contrasena, salt);
        await userModel.cambiarContrasena(req.params.id, contrasena_hash);
        res.json({ mensaje: 'Contraseña actualizada' });
    } catch (e) {
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
};

const obtenerDatosFormulario = async (req, res) => {
    try {
        const [roles, sucursales] = await Promise.all([
            userModel.obtenerRoles(),
            userModel.obtenerSucursales()
        ]);
        res.json({ roles, sucursales });
    } catch (e) {
        res.status(500).json({ error: 'Error al obtener datos del formulario' });
    }
};

module.exports = {
    registrarUsuario, loginUsuario, listarUsuarios,
    actualizarUsuario, desactivarUsuario, reactivarUsuario,
    cambiarContrasena, obtenerDatosFormulario
};