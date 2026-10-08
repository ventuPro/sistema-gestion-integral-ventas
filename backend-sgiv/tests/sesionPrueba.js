const captcha = require('../src/utils/captcha');

// ─── Login para pruebas: CAPTCHA + contraseña ───
// El servidor corre en el mismo proceso, así que se comparte el almacén de CAPTCHA.
const resolverCaptcha = () => {
    const { id, texto } = captcha.crear();
    return { id_captcha: id, captcha: texto };
};

const crearLogin = (api) => async (correo, contrasena) =>
    (await api('POST', '/usuarios/login',
        { body: { correo_electronico: correo, contrasena, ...resolverCaptcha() } })).body.token;

module.exports = { resolverCaptcha, crearLogin };
