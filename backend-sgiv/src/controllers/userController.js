const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

// --- REGISTRAR USUARIO ---
const registrarUsuario = async (req, res) => {
    try {
        const { id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena } = req.body;

        // 1. Verificar si el correo ya existe
        const usuarioExistente = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (usuarioExistente) {
            return res.status(400).json({ error: 'El correo ya está registrado' });
        }

        // 2. Encriptar la contraseña (hash)
        const salt = await bcrypt.genSalt(10);
        const contrasena_hash = await bcrypt.hash(contrasena, salt);

        // 3. Guardar en la base de datos
        const nuevoUsuario = await userModel.crearUsuario({
            id_sucursal,
            id_rol,
            nombre_completo,
            correo_electronico,
            contrasena_hash
        });

        res.status(201).json({ mensaje: 'Usuario creado exitosamente', usuario: nuevoUsuario });
    } catch (error) {
        console.error('Error en registrarUsuario:', error);
        res.status(500).json({ error: 'Error interno del servidor al registrar usuario' });
    }
};

// --- LOGIN DE USUARIO ---
const loginUsuario = async (req, res) => {
    try {
        const { correo_electronico, contrasena } = req.body;

        // 1. Buscar al usuario por correo
        const usuario = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // 2. Verificar que la contraseña coincida con el hash
        const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena_hash);
        if (!contrasenaValida) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // 3. Generar el Token JWT (Sesión)
        const token = jwt.sign(
            { 
                id_usuario: usuario.id_usuario, 
                id_rol: usuario.id_rol, 
                id_sucursal: usuario.id_sucursal 
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' } // El token expira en 8 horas
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

module.exports = { registrarUsuario, loginUsuario };