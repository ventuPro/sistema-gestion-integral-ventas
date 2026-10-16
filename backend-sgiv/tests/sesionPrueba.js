const captcha = require('../src/utils/captcha');

// ─── Login para pruebas: CAPTCHA + contraseña ───
// El servidor corre en el mismo proceso, así que se comparte el almacén de CAPTCHA.
const resolverCaptcha = () => {
    const { id, texto } = captcha.crear();
    return { id_captcha: id, captcha: texto };
};

/** Token de la cookie httpOnly que deja el login (las pruebas lo envían como Bearer). */
const tokenDeCookie = (headers) => {
    const cookie = (headers.getSetCookie?.() || [headers.get('set-cookie')]).find(c => c?.startsWith('sgiv_sesion='));
    return cookie ? decodeURIComponent(cookie.split(';')[0].slice('sgiv_sesion='.length)) : null;
};

const crearLogin = (api) => async (correo, contrasena) =>
    tokenDeCookie((await api('POST', '/usuarios/login',
        { body: { correo_electronico: correo, contrasena, ...resolverCaptcha() } })).headers);

module.exports = { resolverCaptcha, crearLogin, tokenDeCookie };
