const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const userModel   = require('../models/userModel');
const db          = require('../config/db');
const QRCode      = require('qrcode');
const captcha     = require('../utils/captcha');
const totp        = require('../utils/totp');
const {
    JWT_SECRET, JWT_OPCIONES, JWT_ALGORITMOS,
    JWT_SECRET_MFA, JWT_OPCIONES_MFA, cifrarSecretoMfa, descifrarSecretoMfa
} = require('../config/seguridad');

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

// ─── Login (paso 1: CAPTCHA + contraseña) ───
// Mismo mensaje y mismo tiempo de respuesta si el correo no existe o la
// contraseña es incorrecta, para no revelar qué correos están registrados.
// Además se limita la cantidad de intentos fallidos por IP + correo.
const HASH_FICTICIO       = bcrypt.hashSync('sgiv-hash-ficticio', 10);
const MAX_INTENTOS        = 5;
const VENTANA_BLOQUEO_MS  = 15 * 60 * 1000;
const intentosFallidos    = new Map();   // clave → { cantidad, desde }

// Limpieza periódica para que el registro de intentos no crezca indefinidamente
setInterval(() => {
    const ahora = Date.now();
    for (const [clave, r] of intentosFallidos)
        if (ahora - r.desde > VENTANA_BLOQUEO_MS) intentosFallidos.delete(clave);
}, VENTANA_BLOQUEO_MS).unref();

const EMISOR_MFA   = 'SGIV Rickys';
const MFA_EXPIRADO = { error: 'La verificación venció. Inicie sesión nuevamente.', codigo: 'MFA_EXPIRADO' };
const MFA_DANADO   = { error: 'Su verificación en dos pasos no es válida. Pida al administrador que la restablezca.', codigo: 'MFA_INVALIDO' };

const claveIntento = (req, correo) => `${req.ip}|${String(correo || '').toLowerCase()}`;

const estaBloqueado = (clave) => {
    const r = intentosFallidos.get(clave);
    if (!r) return false;
    if (Date.now() - r.desde > VENTANA_BLOQUEO_MS) { intentosFallidos.delete(clave); return false; }
    return r.cantidad >= MAX_INTENTOS;
};

const registrarFallo = (clave) => {
    const r = intentosFallidos.get(clave);
    if (!r || Date.now() - r.desde > VENTANA_BLOQUEO_MS) intentosFallidos.set(clave, { cantidad: 1, desde: Date.now() });
    else r.cantidad++;
};

const loginUsuario = async (req, res) => {
    try {
        const { correo_electronico, contrasena, id_captcha, captcha: respuestaCaptcha } = req.body || {};
        if (!correo_electronico || !contrasena)
            return res.status(400).json({ error: 'Ingrese correo y contraseña' });

        if (!captcha.verificar(id_captcha, respuestaCaptcha))
            return res.status(400).json({ error: 'El código de la imagen es incorrecto o venció', codigo: 'CAPTCHA_INVALIDO' });

        const clave = claveIntento(req, correo_electronico);
        if (estaBloqueado(clave))
            return res.status(429).json({ error: 'Demasiados intentos fallidos. Intente de nuevo en 15 minutos.' });

        const u = await userModel.obtenerUsuarioPorCorreo(correo_electronico);
        const valida = await bcrypt.compare(String(contrasena), u ? u.contrasena_hash : HASH_FICTICIO);
        if (!u || !valida) {
            registrarFallo(clave);
            return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
        }
        intentosFallidos.delete(clave);

        // La contraseña es correcta: falta el segundo factor
        const token_mfa = jwt.sign({ id_usuario: u.id_usuario, proposito: 'mfa' }, JWT_SECRET_MFA, JWT_OPCIONES_MFA);
        let secreto = u.mfa_secreto ? descifrarSecretoMfa(u.mfa_secreto) : null;

        if (u.mfa_activo) {
            if (!secreto) return res.status(409).json(MFA_DANADO);
            return res.json({ paso: 'verificar_mfa', token_mfa });
        }

        // Primer ingreso (o MFA restablecido): se reutiliza el secreto pendiente si existe
        if (!secreto) {
            secreto = totp.generarSecreto();
            await userModel.guardarSecretoMfaPendiente(u.id_usuario, cifrarSecretoMfa(secreto));
        }
        const qr = await QRCode.toDataURL(totp.uriOtpauth(secreto, u.correo_electronico, EMISOR_MFA), { margin: 1, width: 240 });
        res.json({
            paso: 'configurar_mfa',
            token_mfa,
            mfa: { qr, secreto, emisor: EMISOR_MFA, cuenta: u.correo_electronico }
        });
    } catch(e) {
        console.error('Error loginUsuario:', e);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
};

const obtenerCaptcha = (req, res) => {
    const { id, svg } = captcha.crear();
    res.set('Cache-Control', 'no-store');
    res.json({ id_captcha: id, imagen: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
};

// ─── Segundo factor: código de la app autenticadora ───
const verificarMfa = async (req, res) => {
    try {
        const { token_mfa, codigo } = req.body || {};
        let payload;
        try {
            payload = jwt.verify(String(token_mfa || ''), JWT_SECRET_MFA, { algorithms: JWT_ALGORITMOS });
        } catch { payload = null; }
        if (!payload || payload.proposito !== 'mfa') return res.status(401).json(MFA_EXPIRADO);

        const clave = `mfa|${payload.id_usuario}`;
        if (estaBloqueado(clave))
            return res.status(429).json({ error: 'Demasiados códigos incorrectos. Intente de nuevo en 15 minutos.' });

        const u = await userModel.obtenerUsuarioActivoPorId(payload.id_usuario);
        if (!u) return res.status(401).json(MFA_EXPIRADO);
        const secreto = u.mfa_secreto ? descifrarSecretoMfa(u.mfa_secreto) : null;
        if (!secreto) return res.status(409).json(MFA_DANADO);

        // Cada código sirve una sola vez (el paso debe ser posterior al último usado)
        const paso = totp.verificar(secreto, codigo);
        const confirmado = paso !== null &&
            await userModel.registrarPasoMfa(u.id_usuario, u.mfa_secreto, paso);
        if (!confirmado) {
            registrarFallo(clave);
            return res.status(401).json({ error: 'Código incorrecto. Revise su app autenticadora.', codigo: 'MFA_CODIGO_INVALIDO' });
        }
        intentosFallidos.delete(clave);

        const rSuc = await db.query(`SELECT nombre_sucursal FROM sucursal WHERE id_sucursal = $1`, [u.id_sucursal]);
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
                nombre_sucursal: rSuc.rows[0]?.nombre_sucursal || ''
            }
        });
    } catch (e) {
        console.error('Error verificarMfa:', e);
        res.status(500).json({ error: 'Error al verificar el código' });
    }
};

const restablecerMfa = async (req, res) => {
    try {
        if (!esAdmin(req) && await tocaAdmin(req.params.id))
            return res.status(403).json({ error: 'Solo un administrador puede restablecer la verificación de un administrador' });
        const r = await userModel.restablecerMfa(req.params.id);
        if (!r) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json({ mensaje: 'Verificación en dos pasos restablecida' });
    } catch (e) {
        console.error('Error restablecerMfa:', e);
        res.status(500).json({ error: 'Error al restablecer la verificación' });
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
    registrarUsuario, loginUsuario, obtenerCaptcha, verificarMfa, restablecerMfa, listarUsuarios,
    actualizarUsuario, desactivarUsuario, reactivarUsuario,
    cambiarContrasena, obtenerDatosFormulario
};