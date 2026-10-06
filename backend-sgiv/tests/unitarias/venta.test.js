const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { calcularItemsVenta } = require('../../src/models/cajaModel');

// Cliente de BD simulado: devuelve los productos activos del "catálogo"
const catalogo = [
    { id_producto: 1, nombre_producto: 'Torta',  precio_unitario: '25.50' },
    { id_producto: 2, nombre_producto: 'Queque', precio_unitario: '10.10' }
];
const clienteFalso = {
    query: async (_sql, [ids]) => ({ rows: catalogo.filter(p => ids.includes(p.id_producto)) })
};

// ─── POS: calcularItemsVenta ───
test('usa el precio de la BD e ignora el precio enviado por el cliente', async () => {
    const items = await calcularItemsVenta(clienteFalso, [
        { id_producto: 1, cantidad: 2, precio: 0.01, subtotal: 0.02 }
    ]);
    assert.deepEqual(items, [{ id_producto: 1, cantidad: 2, precio: 25.5, subtotalCentavos: 5100 }]);
});

test('calcula en centavos sin errores de redondeo', async () => {
    const items = await calcularItemsVenta(clienteFalso, [{ id_producto: 2, cantidad: 3 }]);
    assert.equal(items[0].subtotalCentavos, 3030);   // 10.10 * 3 en flotante da 30.299999...
});

test('rechaza carrito vacío', async () => {
    await assert.rejects(calcularItemsVenta(clienteFalso, []), { code: 'VENTA_INVALIDA' });
    await assert.rejects(calcularItemsVenta(clienteFalso, undefined), { code: 'VENTA_INVALIDA' });
});

test('rechaza cantidades negativas, cero o decimales', async () => {
    for (const cantidad of [-1, 0, 1.5, 'abc'])
        await assert.rejects(
            calcularItemsVenta(clienteFalso, [{ id_producto: 1, cantidad }]),
            { code: 'VENTA_INVALIDA' }, `cantidad ${cantidad}`
        );
});

test('rechaza productos inexistentes o inactivos', async () => {
    await assert.rejects(
        calcularItemsVenta(clienteFalso, [{ id_producto: 99, cantidad: 1 }]),
        { code: 'VENTA_INVALIDA' }
    );
});
