const { test } = require('node:test');
const assert   = require('node:assert/strict');
const totp     = require('../../src/utils/totp');
const captcha  = require('../../src/utils/captcha');
const { cifrarSecretoMfa, descifrarSecretoMfa } = require('../../src/config/seguridad');

// ─── TOTP ───
// Vectores del RFC 6238 (SHA-1, secreto "12345678901234567890"), últimos 6 dígitos
const SECRETO_RFC = totp.base32Codificar(Buffer.from('12345678901234567890'));

test('genera los códigos de los vectores del RFC 6238', () => {
    const casos = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
                   [1234567890, '005924'], [2000000000, '279037']];
    for (const [segundos, codigo] of casos)
        assert.equal(totp.codigoParaPaso(SECRETO_RFC, Math.floor(segundos / 30)), codigo, String(segundos));
});

test('base32 ida y vuelta, ignorando espacios y minúsculas', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 77]);
    const texto = totp.base32Codificar(bytes);
    assert.deepEqual(totp.base32Decodificar(texto.toLowerCase().replace(/(.{4})/g, '$1 ')), bytes);
    assert.throws(() => totp.base32Decodificar('ABC1'));
});

test('el secreto generado tiene 160 bits y es distinto cada vez', () => {
    const a = totp.generarSecreto();
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.notEqual(a, totp.generarSecreto());
});

test('acepta el código actual y ±1 paso; rechaza fuera de la ventana y formatos raros', () => {
    const ms   = 1_700_000_000_000;
    const paso = totp.pasoActual(ms);
    const s    = SECRETO_RFC;
    assert.equal(totp.verificar(s, totp.codigoParaPaso(s, paso), ms), paso);
    assert.equal(totp.verificar(s, totp.codigoParaPaso(s, paso - 1), ms), paso - 1);
    assert.equal(totp.verificar(s, totp.codigoParaPaso(s, paso + 1), ms), paso + 1);
    assert.equal(totp.verificar(s, totp.codigoParaPaso(s, paso - 3), ms), null);
    for (const malo of ['', '12345', '1234567', 'abcdef', null, undefined])
        assert.equal(totp.verificar(s, malo, ms), null, String(malo));
});

test('la URI otpauth sigue el formato de Google Authenticator', () => {
    const uri = totp.uriOtpauth('JBSWY3DPEHPK3PXP', 'cajero@rickys.com', 'SGIV Rickys');
    assert.match(uri, /^otpauth:\/\/totp\/SGIV%20Rickys%3Acajero%40rickys\.com\?/);
    const p = new URL(uri).searchParams;
    assert.equal(p.get('secret'), 'JBSWY3DPEHPK3PXP');
    assert.equal(p.get('issuer'), 'SGIV Rickys');
    assert.equal(p.get('digits'), '6');
    assert.equal(p.get('period'), '30');
});

// ─── Cifrado del secreto ───
test('cifra y descifra el secreto; cada cifrado es distinto', () => {
    const a = cifrarSecretoMfa('JBSWY3DPEHPK3PXP');
    assert.notEqual(a, cifrarSecretoMfa('JBSWY3DPEHPK3PXP'));
    assert.equal(descifrarSecretoMfa(a), 'JBSWY3DPEHPK3PXP');
});

test('un secreto alterado o con otro formato no se descifra', () => {
    const partes = cifrarSecretoMfa('JBSWY3DPEHPK3PXP').split(':');
    partes[3] = Buffer.from('otro').toString('base64');
    assert.equal(descifrarSecretoMfa(partes.join(':')), null);
    assert.equal(descifrarSecretoMfa('JBSWY3DPEHPK3PXP'), null);
    assert.equal(descifrarSecretoMfa(null), null);
});

// ─── CAPTCHA ───
test('el SVG del CAPTCHA no contiene el texto en claro', () => {
    const { texto, svg } = captcha.crear();
    assert.equal(texto.length, 5);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!svg.includes('<text'));
    assert.ok(!svg.includes(texto));
});

test('el CAPTCHA es de un solo uso, sin distinguir mayúsculas', () => {
    const { id, texto } = captcha.crear();
    assert.equal(captcha.verificar(id, ` ${texto.toUpperCase()} `), true);
    assert.equal(captcha.verificar(id, texto), false);
});

test('una respuesta incorrecta también consume el CAPTCHA', () => {
    const { id, texto } = captcha.crear();
    assert.equal(captcha.verificar(id, texto + 'x'), false);
    assert.equal(captcha.verificar(id, texto), false);
    assert.equal(captcha.verificar('no-existe', texto), false);
    assert.equal(captcha.verificar(undefined, undefined), false);
});

test('el CAPTCHA vence a los 5 minutos', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const { id, texto } = captcha.crear();
    t.mock.timers.tick(5 * 60 * 1000 + 1);
    assert.equal(captcha.verificar(id, texto), false);
});
