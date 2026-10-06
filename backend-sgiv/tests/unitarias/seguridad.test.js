const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { origenPermitido } = require('../../src/config/seguridad');

// ─── CORS: origenPermitido ───
test('permite peticiones sin Origin (Postman, curl, servidor a servidor)', () => {
    assert.equal(origenPermitido(undefined, 'localhost:3000'), true);
});

test('permite localhost y la red local', () => {
    for (const o of ['http://localhost:4200', 'http://127.0.0.1:4200',
                     'http://192.168.1.20:4200', 'http://10.0.0.5', 'http://172.20.0.3:80'])
        assert.equal(origenPermitido(o, 'servidor:3000'), true, o);
});

test('permite el frontend servido desde el mismo host que el backend', () => {
    assert.equal(origenPermitido('https://rickys.com', 'rickys.com:3000'), true);
});

test('rechaza orígenes ajenos', () => {
    assert.equal(origenPermitido('https://evil.com', 'rickys.com:3000'), false);
    assert.equal(origenPermitido('http://172.32.0.1', 'rickys.com:3000'), false);
    assert.equal(origenPermitido('no-es-una-url', 'rickys.com:3000'), false);
});
