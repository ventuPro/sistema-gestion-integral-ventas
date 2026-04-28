const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

// --- REGISTRAR USUARIO (existente) ---
const registrarUsuario = async (req, res) => {
    try {
        const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena } = req.body;

        const usuarioExistente = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (usuarioExistente) {
            return res.status(400).json({ error: 'El correo ya está registrado' });
        }

        const salt = await bcrypt.genSalt(10);
        const contrasena_hash = await bcrypt.hash(contrasena, salt);

        const nuevoUsuario = await userModel.crearUsuario({
            id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash
        });

        res.status(201).json({ mensaje: 'Usuario creado exitosamente', usuario: nuevoUsuario });
    } catch (error) {
        console.error('Error en registrarUsuario:', error);
        res.status(500).json({ error: 'Error interno del servidor al registrar usuario' });
    }
};

// --- LOGIN (existente) ---
const loginUsuario = async (req, res) => {
    try {
        const { correo_electronico, contrasena } = req.body;

        const usuario = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena_hash);
        if (!contrasenaValida) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        const token = jwt.sign(
            { id_usuario: usuario.id_usuario, id_rol: usuario.id_rol, id_sucursal: usuario.id_sucursal },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: 'Inicio de sesión exitoso',
            token,
            usuario: {
                id_usuario: usuario.id_usuario,
                nombre_completo: usuario.nombre_completo,
                id_rol: usuario.id_rol
            }
        });
    } catch (error) {
        console.error('Error en loginUsuario:', error);
        res.status(500).json({ error: 'Error interno del servidor al iniciar sesión' });
    }
};

// ─── NUEVOS CONTROLADORES ──────────────────────────────────────

// Listar todos los usuarios
const listarUsuarios = async (req, res) => {
    try {
        const usuarios = await userModel.obtenerTodosLosUsuarios();
        res.json(usuarios);
    } catch (error) {
        console.error('Error en listarUsuarios:', error);
        res.status(500).json({ error: 'Error al obtener los usuarios' });
    }
};

// Obtener roles y sucursales para los dropdowns del formulario
const obtenerFormularioDatos = async (req, res) => {
    try {
        const [roles, sucursales] = await Promise.all([
            userModel.obtenerRoles(),
            userModel.obtenerSucursales()
        ]);
        res.json({ roles, sucursales });
    } catch (error) {
        console.error('Error en obtenerFormularioDatos:', error);
        res.status(500).json({ error: 'Error al obtener datos del formulario' });
    }
};

// Editar usuario (sin contraseña)
const editarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const usuarioActualizado = await userModel.actualizarUsuario(id, req.body);

        if (!usuarioActualizado) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ mensaje: 'Usuario actualizado correctamente', usuario: usuarioActualizado });
    } catch (error) {
        console.error('Error en editarUsuario:', error);
        res.status(500).json({ error: 'Error al actualizar el usuario' });
    }
};

// Desactivar usuario (borrado lógico)
const eliminarUsuario = async (req, res) => {
    try {
        const { id } = req.params;
        const usuarioDesactivado = await userModel.desactivarUsuario(id);

        if (!usuarioDesactivado) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ mensaje: `Usuario "${usuarioDesactivado.nombre_completo}" desactivado correctamente` });
    } catch (error) {
        console.error('Error en eliminarUsuario:', error);
        res.status(500).json({ error: 'Error al desactivar el usuario' });
    }
};

module.exports = { registrarUsuario, loginUsuario, listarUsuarios, obtenerFormularioDatos, editarUsuario, eliminarUsuario };