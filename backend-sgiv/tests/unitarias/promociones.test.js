const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { repartir, aplicarPromociones, descuentoManual, normalizar } = require('../../src/models/promocionModel');

// ─── Motor de promociones (sin BD) ───
const linea = (id_producto, cantidad, precio, id_categoria = 1) =>
    ({ id_producto, id_categoria, cantidad, precioCentavos: Math.round(precio * 100) });
const promo = (id_promocion, tipo, extra = {}) =>
    ({ id_promocion, nombre: `P${id_promocion}`, tipo, valor: 0, lleva: null, paga: null, productos: [], categorias: [], ...extra });
const ahorro = (lineas) => lineas.reduce((s, l) => s + l.descuentoPromoCentavos, 0);

test('repartir conserva el total exacto', () => {
    assert.deepEqual(repartir(100, [1, 1, 1]), [34, 33, 33]);
    assert.equal(repartir(1001, [3, 7, 11]).reduce((s, x) => s + x, 0), 1001);
    assert.deepEqual(repartir(50, [0, 0]), [50, 0]);
});

test('porcentaje sobre una categoría', () => {
    const r = aplicarPromociones([linea(1, 2, 25), linea(2, 1, 10, 9)], [promo(1, 'PORCENTAJE', { valor: 10, categorias: [1] })]);
    assert.equal(r[0].descuentoPromoCentavos, 500);   // 10 % de 50
    assert.equal(r[1].descuentoPromoCentavos, 0);     // otra categoría
    assert.equal(r[0].id_promocion, 1);
});

test('precio especial por unidad', () => {
    const r = aplicarPromociones([linea(1, 3, 3)], [promo(1, 'PRECIO', { valor: 2, productos: [{ id_producto: 1, cantidad: 1 }] })]);
    assert.equal(ahorro(r), 300);
});

test('3×2: una de cada tres gratis', () => {
    const p = [promo(1, 'NXM', { lleva: 3, paga: 2, productos: [{ id_producto: 1, cantidad: 1 }] })];
    assert.equal(ahorro(aplicarPromociones([linea(1, 2, 5)], p)), 0);
    assert.equal(ahorro(aplicarPromociones([linea(1, 3, 5)], p)), 500);
    assert.equal(ahorro(aplicarPromociones([linea(1, 7, 5)], p)), 1000);
});

test('con varias promociones gana la que más ahorra', () => {
    const r = aplicarPromociones([linea(1, 3, 10)], [
        promo(1, 'PORCENTAJE', { valor: 20, productos: [{ id_producto: 1, cantidad: 1 }] }),   // 6 Bs.
        promo(2, 'NXM', { lleva: 3, paga: 2, productos: [{ id_producto: 1, cantidad: 1 }] })   // 10 Bs.
    ]);
    assert.equal(ahorro(r), 1000);
    assert.equal(r[0].id_promocion, 2);
});

test('combo: café + porción a precio especial, se repite y el sobrante paga normal', () => {
    const combo = promo(5, 'COMBO', { valor: 15, productos: [{ id_producto: 1, cantidad: 1 }, { id_producto: 2, cantidad: 1 }] });
    const r = aplicarPromociones([linea(1, 2, 8), linea(2, 3, 12)], [combo]);
    assert.equal(ahorro(r), 2 * (2000 - 1500));     // dos combos; la tercera porción sin descuento
    assert.equal(r[0].descuentoPromoCentavos + r[1].descuentoPromoCentavos, 1000);
});

test('el combo no se usa si las promociones simples ahorran más', () => {
    const r = aplicarPromociones([linea(1, 1, 10), linea(2, 1, 10)], [
        promo(1, 'COMBO', { valor: 19, productos: [{ id_producto: 1, cantidad: 1 }, { id_producto: 2, cantidad: 1 }] }),  // 1 Bs.
        promo(2, 'PORCENTAJE', { valor: 50, categorias: [1] })                                                          // 10 Bs.
    ]);
    assert.equal(ahorro(r), 1000);
    assert.ok(r.every(l => l.id_promocion === 2));
});

test('un producto repartido en varias líneas se evalúa junto (mesas)', () => {
    const p = [promo(1, 'NXM', { lleva: 2, paga: 1, productos: [{ id_producto: 1, cantidad: 1 }] })];
    const r = aplicarPromociones([linea(1, 1, 6), linea(1, 1, 6)], p);
    assert.equal(ahorro(r), 600);
});

test('el descuento nunca supera el precio', () => {
    const r = aplicarPromociones([linea(1, 1, 5)], [promo(1, 'PRECIO', { valor: 0.01, productos: [{ id_producto: 1, cantidad: 1 }] })]);
    assert.ok(r[0].descuentoPromoCentavos <= r[0].brutoCentavos);
});

// ─── Descuento manual ───
test('descuento manual sin tope: en % o en bolivianos, hasta casi todo', () => {
    assert.deepEqual(descuentoManual(10000, { tipo: 'PORCENTAJE', valor: 90, motivo: 'Cliente frecuente' }),
                     { centavos: 9000, motivo: 'Cliente frecuente' });
    assert.equal(descuentoManual(10000, { tipo: 'MONTO', valor: 99.5, motivo: 'Torta golpeada' }).centavos, 9950);
    assert.equal(descuentoManual(10000, { tipo: 'PORCENTAJE', valor: 100, motivo: 'Cortesía' }).centavos, 10000);
});

test('descuento manual: motivo obligatorio y nunca más que el total', () => {
    assert.throws(() => descuentoManual(10000, { tipo: 'PORCENTAJE', valor: 5, motivo: '' }), { code: 'DESCUENTO_INVALIDO' });
    assert.throws(() => descuentoManual(1000, { tipo: 'MONTO', valor: 11, motivo: 'Exceso' }), { code: 'DESCUENTO_INVALIDO' });
    assert.throws(() => descuentoManual(1000, { tipo: 'PORCENTAJE', valor: 101, motivo: 'Exceso' }), { code: 'DESCUENTO_INVALIDO' });
    assert.deepEqual(descuentoManual(1000, null), { centavos: 0, motivo: null });
});

// ─── Validación ───
const base = { nombre: 'Promo', tipo: 'PORCENTAJE', valor: 10, categorias: [1], fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31' };

test('normaliza una promoción válida', () => {
    const d = normalizar({ ...base, dias_semana: [5, 1, 1], hora_inicio: '19:00', hora_fin: '21:00' });
    assert.deepEqual(d.dias_semana, [1, 5]);
    assert.equal(d.id_sucursal, null);
    assert.equal(normalizar({ ...base, dias_semana: [1, 2, 3, 4, 5, 6, 7] }).dias_semana, null);
});

test('rechaza promociones mal armadas', () => {
    const casos = [
        { ...base, nombre: 'x' },
        { ...base, tipo: 'OTRO' },
        { ...base, valor: 100 },
        { ...base, categorias: [] },
        { ...base, fecha_inicio: '2026-11-01' },
        { ...base, hora_inicio: '19:00' },
        { ...base, tipo: 'NXM', lleva: 2, paga: 2 },
        { ...base, tipo: 'PRECIO', valor: 2 },
        { ...base, tipo: 'COMBO', valor: 10, categorias: [], productos: [{ id_producto: 1, cantidad: 1 }] }
    ];
    for (const c of casos) assert.throws(() => normalizar(c), { code: 'PROMOCION_INVALIDA' }, JSON.stringify(c));
});
