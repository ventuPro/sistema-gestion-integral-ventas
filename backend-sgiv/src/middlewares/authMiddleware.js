// Archivo: src/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
    // 1. Buscamos el token en los headers de la petición que envía Angular
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Separa la palabra "Bearer" del token real

    // 2. Si no hay token, lo rebotamos
    if (!token) {
        return res.status(401).json({ mensaje: 'Acceso denegado. No se proporcionó un token de seguridad.' });
    }

    try {
        // 3. Verificamos que el token sea auténtico
        // NOTA: Asegúrate de que esta clave secreta sea la misma que usaste en tu userController al hacer el Login.
        const secret = process.env.JWT_SECRET || 'ventupro2503_Security_key'; 
        
        const usuarioDecodificado = jwt.verify(token, secret);
        
        // 4. Si todo está bien, guardamos los datos del usuario y lo dejamos pasar
        req.usuario = usuarioDecodificado;
        next(); // ¡Abre la puerta!
        
    } catch (error) {
        return res.status(403).json({ mensaje: 'El token es inválido o ha expirado. Por favor, inicie sesión nuevamente.' });
    }
};

module.exports = {
    verificarToken
};