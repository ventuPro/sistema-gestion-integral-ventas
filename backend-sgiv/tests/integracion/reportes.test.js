const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Panel e informes ───

let bd, servidor, io, pool, URL_BASE, tAdmin, tCajero;
let catA, catB, prodA, prodB, prodSinVenta, suc2;

const api = async (ruta, token, metodo = 'GET', body) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
};

const venta = async (id_sucursal, fecha, lineas, metodo = 'Efectivo') => {
    const total = lineas.reduce((s, [, cant, precio]) => s + cant * precio, 0);
    const [v] = await bd.sql(
        `INSERT INTO venta_caja (id_sucursal, monto_total_venta, metodo_pago, fecha_venta)
         VALUES ($1, $2, $3, $4) RETURNING id_venta`, [id_sucursal, total, metodo, fecha]);
    for (const [id_producto, cant, precio] of lineas) {
        await bd.sql(
            `INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
             VALUES ($1, $2, $3, $4, $5)`, [v.id_venta, id_producto, cant, precio, cant * precio]);
    }
};

before(async () => {
    bd = await crearBdPrueba();
    [{ id_categoria: catA }] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Tortas R') RETURNING id_categoria`);
    [{ id_categoria: catB }] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Bebidas R') RETURNING id_categoria`);
    const producto = async (cat, nombre, precio) => {
        const [p] = await bd.sql(`INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
                                  VALUES ($1, $2, $3) RETURNING id_producto`, [cat, nombre, precio]);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, 20)`, [p.id_producto]);
        return p.id_producto;
    };
    prodA        = await producto(catA, 'Torta R', 50);
    prodB        = await producto(catB, 'Jugo R', 10);
    prodSinVenta = await producto(catA, 'Queque sin venta R', 30);
    [{ id_sucursal: suc2 }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sucursal R2') RETURNING id_sucursal`);

    // Período de prueba: 2026-03-02 (lunes) al 2026-03-08; período anterior: 2026-02-23 al 03-01
    await venta(1, '2026-03-02 10:15', [[prodA, 2, 50], [prodB, 1, 10]]);   // 110
    await venta(1, '2026-03-04 16:40', [[prodB, 3, 10]], 'QR');            // 30
    await venta(1, '2026-02-25 11:00', [[prodA, 1, 50]]);                  // 50 (anterior)
    await venta(suc2, '2026-03-03 09:00', [[prodA, 1, 50]]);               // 50 (otra sucursal)

    const hash = await bcrypt.hash('Prueba123', 4);
    await bd.sql(`INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
                  VALUES (1, 2, 'Cajero R', 'cajero.reportes@prueba.com', $1)`, [hash]);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    const login = crearLogin(async (metodo, ruta, { body }) => {
        const r = await fetch(`${URL_BASE}/api${ruta}`, {
            method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        return { body: await r.json(), headers: r.headers };
    });
    tAdmin  = await login('admin@rickys.com', 'password');
    tCajero = await login('cajero.reportes@prueba.com', 'Prueba123');
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

const PERIODO = '?fecha_inicio=2026-03-02&fecha_fin=2026-03-08';

describe('Informe por período', () => {
    test('totales, período anterior y días sin venta en cero', async () => {
        const { status, body } = await api(`/reportes/periodo/1${PERIODO}`, tAdmin);
        assert.equal(status, 200);
        assert.equal(body.resumen.total_ventas, 2);
        assert.equal(body.resumen.ingresos_totales, 140);
        assert.equal(body.resumen.ticket_promedio, 70);
        assert.equal(body.resumen.unidades, 6);
        assert.equal(body.anterior.ingresos_totales, 50);
        assert.deepEqual(body.periodo_anterior, ['2026-02-23', '2026-03-01']);
        assert.equal(body.ventas_diarias.length, 7);
        assert.equal(body.ventas_diarias[1].ingresos, 0);
    });

    test('desgloses por método, hora, día de semana y productos sin venta', async () => {
        const { body } = await api(`/reportes/periodo/1${PERIODO}`, tAdmin);
        assert.deepEqual(body.metodos_pago.map(m => [m.metodo_pago, m.ingresos]), [['Efectivo', 110], ['QR', 30]]);
        assert.deepEqual(body.por_hora.map(h => h.hora), [10, 16]);
        const lunes = body.por_dia_semana.find(d => d.dia_semana === 1);
        assert.equal(lunes.dias, 1);
        assert.equal(lunes.ingresos, 110);
        assert.ok(body.sin_ventas.some(p => p.nombre_producto === 'Queque sin venta R'));
        assert.equal(body.productos[0].nombre_producto, 'Torta R');
        assert.equal(body.inventario.productos >= 3, true);
    });

    test('filtro por categoría: solo la parte de esas categorías', async () => {
        const { body } = await api(`/reportes/periodo/1${PERIODO}&categorias=${catB}`, tAdmin);
        assert.equal(body.resumen.total_ventas, 2);
        assert.equal(body.resumen.ingresos_totales, 40);
        assert.equal(body.resumen.unidades, 4);
        assert.deepEqual(body.productos.map(p => p.nombre_producto), ['Jugo R']);
    });

    test('administrador con sucursal 0 = todas las sucursales', async () => {
        const { body } = await api(`/reportes/periodo/0${PERIODO}`, tAdmin);
        assert.equal(body.resumen.ingresos_totales, 190);
        assert.equal(body.por_sucursal.length, 2);
    });

    test('fechas inválidas o invertidas → 400', async () => {
        assert.equal((await api('/reportes/periodo/1?fecha_inicio=2026-03-08&fecha_fin=2026-03-02', tAdmin)).status, 400);
        assert.equal((await api('/reportes/periodo/1?fecha_inicio=x&fecha_fin=2026-03-02', tAdmin)).status, 400);
        assert.equal((await api('/reportes/periodo/1?fecha_inicio=2024-01-01&fecha_fin=2026-03-02', tAdmin)).status, 400);
    });

});

describe('Permisos de informes', () => {
    test('cajero sin permiso de reportes → 403', async () => {
        assert.equal((await api(`/reportes/periodo/1${PERIODO}`, tCajero)).status, 403);
    });

    test('cajero en el panel: siempre su sucursal, aunque pida otra o todas', async () => {
        const propia = await api('/reportes/dashboard-completo/1', tCajero);
        const otra   = await api(`/reportes/dashboard-completo/${suc2}`, tCajero);
        const todas  = await api('/reportes/dashboard-completo/0', tCajero);
        assert.equal(propia.status, 200);
        assert.deepEqual(otra.body.stock, propia.body.stock);
        assert.deepEqual(todas.body.sucursales, []);
        assert.deepEqual(propia.body.cajas_abiertas, []);
    });
});

describe('Panel del día', () => {
    test('estructura completa', async () => {
        const { status, body } = await api('/reportes/dashboard-completo/1', tAdmin);
        assert.equal(status, 200);
        for (const k of ['hoy', 'comparativo', 'metodos_pago', 'por_hora', 'turnos_abiertos', 'mesas', 'pedidos_qr', 'stock', 'ultimas_ventas'])
            assert.ok(k in body, k);
        assert.ok(body.stock.productos >= 3);
        assert.ok(Array.isArray(body.cajas_abiertas));
    });
});

describe('periodoAnterior', () => {
    test('misma duración, inmediatamente antes', () => {
        const { periodoAnterior } = require('../../src/models/reporteModel');
        assert.deepEqual(periodoAnterior('2026-03-01', '2026-03-31'), ['2026-01-29', '2026-02-28']);
        assert.deepEqual(periodoAnterior('2026-03-10', '2026-03-10'), ['2026-03-09', '2026-03-09']);
    });
});

describe('Arqueo y cierre de caja con efectivo contado', () => {
    test('esperado = fondo + efectivo del turno; guarda contado y diferencia', async () => {
        assert.equal((await api('/caja/turnos/abrir', tCajero, 'POST', { id_sucursal: 1, monto_inicial: 100 })).status, 201);
        const cobro = (metodo_pago, cantidad) => api('/caja/cobrar', tCajero, 'POST',
            { id_sucursal: 1, metodo_pago, monto_total_venta: cantidad * 10, detalles: [{ id_producto: prodB, cantidad }] });
        assert.equal((await cobro('Efectivo', 2)).status, 201);
        assert.equal((await cobro('QR', 1)).status, 201);

        const arqueo = (await api('/caja/arqueo/1', tCajero)).body;
        assert.equal(arqueo.turno_resumen.efectivo, 20);
        assert.equal(arqueo.turno_resumen.efectivo_esperado, 120);
        assert.equal(arqueo.turno_resumen.total, 30);

        assert.equal((await api('/caja/cerrar', tCajero, 'POST', { id_sucursal: 1, efectivo_contado: -3 })).status, 400);
        const cierre = (await api('/caja/cerrar', tCajero, 'POST', { id_sucursal: 1, efectivo_contado: 115 })).body;
        assert.equal(cierre.efectivo_esperado, 120);
        assert.equal(cierre.diferencia, -5);

        assert.equal((await api('/caja/cierres', tCajero)).status, 403);
        const cierres = (await api('/caja/cierres', tAdmin)).body;
        const c = cierres.find(x => x.id_turno === cierre.id_turno_cerrado);
        assert.equal(c.efectivo_contado, 115);
        assert.equal(c.diferencia, -5);
    });
});
