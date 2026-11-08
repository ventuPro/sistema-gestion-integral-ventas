const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { revisar, numero, ErrorValidacion } = require('../../src/utils/validacion');

const falla = (fn) => assert.throws(fn, ErrorValidacion);

// ─── Teléfonos de Bolivia ───
describe('celular y teléfono', () => {
    test('celular: 8 dígitos que empiezan con 6 o 7', () => {
        assert.equal(revisar('71234567', 'celular'), '71234567');
        assert.equal(revisar('+591 71234567', 'celular'), '71234567');
        for (const malo of ['81234567', '7123456', '712345678', '1234', '7123456a'])
            falla(() => revisar(malo, 'celular'));
    });

    test('teléfono: celular o fijo (7 dígitos, u 8 con código de área)', () => {
        for (const bueno of ['71234567', '2412345', '22412345', '3345678', '4456789'])
            assert.ok(revisar(bueno, 'telefono'));
        for (const malo of ['5123456', '812345678', '12345', '24123456789'])
            falla(() => revisar(malo, 'telefono'));
    });
});

// ─── Nombres ───
describe('nombres', () => {
    test('nombre de sucursal: rechaza solo signos', () => {
        falla(() => revisar(`/*-+.'"`, 'nombre'));
        falla(() => revisar('---', 'nombre'));
        falla(() => revisar('Centro *', 'nombre'));
        assert.equal(revisar('  Sucursal   Centro  ', 'nombre'), 'Sucursal Centro');
        assert.ok(revisar('Torta 3 Leches (porción)', 'nombre'));
        assert.ok(revisar("Ricky's Sopocachi", 'nombre'));
    });

    test('texto sin sentido: repeticiones, palabras largas, números y teclazos', () => {
        for (const malo of ['suc4444444444444444444444444', 'Sucursal aaaa', 'Sucursalmirafloreselalto', 'Sucursal 1234567',
                            'sdfgh', 'Centro qwrtz', 'Centro ----'])
            falla(() => revisar(malo, 'nombre'));
        for (const bueno of ['Sucursal 2', 'Sucursal Miraflores', 'Torta 3 Leches', 'Pan de 1000 hojas', 'Instrucción', 'Llallagua',
                             'S.R.L.', 'Calle 21 de Calacoto #8000', 'EMPANADA DE ROYAL', 'Schmidt'])
            assert.ok(revisar(bueno, bueno.startsWith('Calle') ? 'direccion' : 'nombre'), bueno);
        falla(() => revisar('Juannnn Pérez', 'persona'));
        falla(() => revisar('JHVGVGHVHG', 'texto'));
        falla(() => revisar('Muy rico!!!!', 'texto'));
        assert.ok(revisar('Pedidos en https://www.facebook.com/rickys o ventas@rickys.com', 'texto'));
    });

    test('persona: solo letras y al menos 3 caracteres', () => {
        assert.ok(revisar('María José Quispe', 'persona'));
        falla(() => revisar('Ana2', 'persona'));
        falla(() => revisar('Al', 'persona'));
    });

    test('obligatorio y largo máximo', () => {
        assert.equal(revisar('', 'nombre'), null);
        falla(() => revisar('', 'nombre', { obligatorio: true }));
        falla(() => revisar('a'.repeat(101), 'nombre', { max: 100 }));
    });
});

// ─── Documentos, correo y enlaces ───
describe('documentos y contacto', () => {
    test('CI con complemento y extensión opcionales', () => {
        for (const bueno of ['1234567', '1234567-1A', '1234567 lp', '1234567-1A LP'])
            assert.ok(revisar(bueno, 'ci'));
        for (const malo of ['123', 'ABC1234', '1234567 XX'])
            falla(() => revisar(malo, 'ci'));
    });

    test('NIT solo dígitos', () => {
        assert.ok(revisar('1234567019', 'nit'));
        falla(() => revisar('12-34', 'nit'));
    });

    test('correo en minúsculas y con formato', () => {
        assert.equal(revisar(' Ana@Correo.COM ', 'correo'), 'ana@correo.com');
        falla(() => revisar('ana@correo', 'correo'));
    });

    test('enlaces con https://', () => {
        assert.ok(revisar('https://facebook.com/rickys', 'url'));
        falla(() => revisar('facebook.com/rickys', 'url'));
    });

    test('texto libre sin caracteres de código', () => {
        assert.ok(revisar('Gracias por su compra @rickys +591', 'texto'));
        falla(() => revisar('<script>', 'texto'));
        assert.equal(revisar('Paso 1\n  Paso 2', 'texto', { multilinea: true }), 'Paso 1\nPaso 2');
    });
});

describe('números', () => {
    test('rango y enteros', () => {
        assert.equal(numero('15.5', { min: 0, max: 100 }), 15.5);
        falla(() => numero(-1, { min: 0 }));
        falla(() => numero(101, { max: 100 }));
        falla(() => numero(1.5, { entero: true }));
        falla(() => numero('abc'));
        assert.equal(numero(''), null);
    });
});
