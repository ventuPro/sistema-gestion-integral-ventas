const captcha = require('../src/utils/captcha');
const totp    = require('../src/utils/totp');
const { cifrarSecretoMfa } = require('../src/config/seguridad');

// ─── Login completo para pruebas: CAPTCHA + contraseña + código TOTP ───
// El servidor corre en el mismo proceso, así que se comparte el almacén de CAPTCHA.
const SECRETO_PRUEBA = totp.generarSecreto();

const resolverCaptcha = () => {
    const { id, texto } = captcha.crear();
    return { id_captcha: id, captcha: texto };
};

const codigoActual = (secreto = SECRETO_PRUEBA) => totp.codigoParaPaso(secreto, totp.pasoActual());

/** Deja al usuario con MFA activo y sin código usado (para iniciar sesión varias veces). */
const prepararMfa = (bd, correo) =>
    bd.sql(`UPDATE usuario SET mfa_secreto = $2, mfa_activo = TRUE, mfa_ultimo_paso = NULL
            WHERE correo_electronico = $1`, [correo, cifrarSecretoMfa(SECRETO_PRUEBA)]);

const crearLogin = (api, obtenerBd) => async (correo, contrasena) => {
    await prepararMfa(obtenerBd(), correo);
    const r1 = await api('POST', '/usuarios/login',
        { body: { correo_electronico: correo, contrasena, ...resolverCaptcha() } });
    if (r1.status !== 200) return undefined;
    const r2 = await api('POST', '/usuarios/login/mfa',
        { body: { token_mfa: r1.body.token_mfa, codigo: codigoActual() } });
    return r2.body.token;
};

module.exports = { SECRETO_PRUEBA, resolverCaptcha, codigoActual, prepararMfa, crearLogin };
