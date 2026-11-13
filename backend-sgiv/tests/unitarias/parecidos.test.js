const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comparar, buscar, esCasiIgual } = require('../../src/utils/parecidos');

// ─── Nombres de productos parecidos ───

const tipo = (a, b) => comparar(a, b).tipo;

test('mismo producto escrito distinto: igual o casi (pide confirmar)', () => {
    for (const [a, b] of [
        ['EMPANADAS QUESO', 'EMPANADA DE QUESO'], ['EMPANADA DE QUESO', 'QUESO EMPANADA'], ['EMPANDA DE QESO', 'EMPANADA DE QUESO'],
        ['TORTA CHOCOLATE', 'TORTA DE CHOCOLATTE'], ['SALTEÑA', 'SALTENAS'], ['CAFE', 'CAFÉ'], ['CAFE CON LECHE', 'CAFÉ C/ LECHE'],
        ['CUÑAPE', 'CUÑAPÉS'], ['BIZCOCHO', 'VISCOCHO'], ['MILHOJAS', 'MIL HOJAS'], ['EMPANADAQUESO', 'EMPANADA DE QUESO'],
        ['PAN DE ARROZ', 'PANES DE ARROZ'], ['GELATINA', 'JELATINA'], ['COCA COLA 2L', 'COCA-COLA 2 L'], ['QUEQUE', 'KEKE'],
        ['LLAJUA', 'YAJUA'], ['TORTA TRES LECHES', 'TORTA 3 LECHES'], ['NUEZ', 'NUECES'], ['CHEESECAKE', 'CHESECAKE'],
        ['PIE DE MANZANA', 'PYE DE MANZANA'], ['CAPUCHINO', 'CAPPUCCINO'], ['FLAN', 'FLANES'], ['TE', 'TES'], ['PAN FRANCES', 'PAN FRANCÉS']
    ]) {
        const r = comparar(a, b);
        assert.ok(['igual', 'casi'].includes(r.tipo), `${a} / ${b}: ${r.tipo} ${r.puntaje}`);
    }
});

test('parecidos o contenidos: se muestran sin bloquear', () => {
    for (const [a, b, t] of [
        ['TORTA DE COCO', 'TORTA DE COCOA', 'parecido'], ['PASTEL', 'PASTELITO', 'parecido'], ['TORTA', 'TARTA', 'parecido'],
        ['EMPANADA', 'EMPANADA DE QUESO', 'contiene'], ['GALLETA', 'GALLETAS DE CHOCOLATE', 'contiene'],
        ['CAPUCHINO', 'CAPPUCCINO GRANDE', 'contiene']
    ]) assert.equal(tipo(a, b), t, `${a} / ${b}`);
});

test('productos distintos no se confunden', () => {
    for (const [a, b] of [
        ['EMPANADA DE QUESO', 'EMPANADA DE POLLO'], ['TORTA DE CHOCOLATE', 'TORTA DE VAINILLA'], ['COCA COLA 2L', 'COCA COLA 3L'],
        ['CAFE SIN AZUCAR', 'CAFE CON AZUCAR'], ['PAN', 'PANQUEQUE'], ['QUESO', 'QUEQUE'], ['MAS', 'MASA'],
        ['TORTA SELVA NEGRA', 'TORTA SELVA BLANCA'], ['MASITA DE COCO', 'MASITA DE CACAO'], ['JUGO DE LIMON', 'LIMONADA'],
        ['TE VERDE', 'TE NEGRO'], ['HELADO', 'GELATINA'], ['EMPANADA DE QUESO', 'TORTA DE QUESO'], ['AGUA 500 ML', 'AGUA 2 L']
    ]) assert.equal(tipo(a, b), null, `${a} / ${b}`);
});

test('buscar ordena por parecido y excluye al propio producto', () => {
    const lista = [
        { id_producto: 1, nombre_producto: 'EMPANADA DE QUESO' }, { id_producto: 2, nombre_producto: 'EMPANADA DE POLLO' },
        { id_producto: 3, nombre_producto: 'EMPANADAS DE QUESO' }, { id_producto: 4, nombre_producto: 'TORTA DE CHOCOLATE' }
    ];
    const r = buscar('EMPANADA QUESO', lista, { excluir: 3 });
    assert.deepEqual(r.map(x => x.id_producto), [1]);
    assert.ok(esCasiIgual(r[0]));
    assert.deepEqual(buscar('EMPANADA', lista).map(x => x.id_producto).sort(), [1, 2, 3]);
});
