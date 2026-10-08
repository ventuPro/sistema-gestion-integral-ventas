const { test } = require('node:test');
const assert   = require('node:assert/strict');
const captcha  = require('../../src/utils/captcha');

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
