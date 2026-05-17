const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const userModel   = require('../models/userModel');

const registrarUsuario = async (req, res) => {
    try {
        const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena } = req.body;
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
            process.env.JWT_SECRET || 'ventupro2503_Security_key',
            { expiresIn: '8h' }
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
        const usuario = await userModel.actualizarUsuario(req.params.id, req.body);
        res.json({ mensaje: 'Usuario actualizado', usuario });
    } catch (e) {
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
};

const desactivarUsuario = async (req, res) => {
    try {
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
        const { nueva_contrasena } = req.body;
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