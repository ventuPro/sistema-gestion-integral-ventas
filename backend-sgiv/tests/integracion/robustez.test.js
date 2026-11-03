const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');
const { crearPedir, celularAzar } = require('../menuPrueba');

// ─── Robustez: concurrencia, doble envío, rollback, conciliación, redondeo, medianoche y tiempo real ───
// Backend real contra una BD temporal. Cada bloque usa sus propios productos para no mezclar cuentas.

let bd, servidor, io, pool, URL_BASE, tAdmin, idCentro, idSur, hoy, manana;
const CLAVE = 'Prueba123';
let n = 0;

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    return { status: r.status, body: datos, headers: r.headers };
};
const iniciarSesion = crearLogin((...a) => api(...a));
const pedir = crearPedir((...a) => api(...a));

const crearCajero = async (id_sucursal = 1) => {
    const correo = `robusto${++n}@prueba.com`;
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, 2, $2, $2, $3) RETURNING id_usuario`, [id_sucursal, correo, hash]);
    await api('PUT', `/permisos/usuario/${u.id_usuario}`, { token: tAdmin,
        body: { permisos: { inventario: true, punto_venta: true, mesas: true, arqueo: true, dashboard: true, reportes: true } } });
    const cajero = { id: u.id_usuario, token: await iniciarSesion(correo, CLAVE), id_sucursal };
    const r = await api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal, monto_inicial: 100 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    cajero.id_turno = r.body.turno.id_turno;
    return cajero;
};

/** Producto creado como en Inventario (deja «Stock inicial» en el historial) */
const crearProducto = async (stock, precio = 10, id_sucursal = 1) => {
    const [{ id }] = await bd.sql(`SELECT min(id_categoria) AS id FROM categoria_producto`);
    const r = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
        nombre_producto: `ROBUSTEZ ${++n}`, precio_unitario: precio, id_categoria: id, id_sucursal, stock_inicial: stock } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.producto.id_producto;
};

const stock = async (id_producto, id_sucursal = 1) =>
    (await bd.sql(`SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`,
                  [id_producto, id_sucursal]))[0]?.cantidad_actual;

const crearMesa = async (id_sucursal = 1) => (await bd.sql(
    `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr, estado_mesa, fecha_habilitacion)
     VALUES ($1, $2, md5(random()::text), 'Ocupada', NOW()) RETURNING id_mesa, codigo_qr`, [id_sucursal, 500 + (++n)]))[0];

const cobrar = (cajero, detalles, metodo_pago = 'Efectivo', descuento) => api('POST', '/caja/cobrar',
    { token: cajero.token, body: { id_sucursal: cajero.id_sucursal, metodo_pago, detalles, descuento } });

const abrirCuenta = async (cajero, id_mesa) => {
    const r = await api('POST', '/cuentas/abrir', { token: cajero.token, body: { id_mesa } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.cuenta.id_cuenta;
};
const agregar = (cajero, id_cuenta, id_producto, cantidad = 1) =>
    api('POST', `/cuentas/${id_cuenta}/producto`, { token: cajero.token, body: { id_producto, cantidad } });

const centavos = (x) => Math.round(Number(x) * 100);
const contar = async (sql, params) => (await bd.sql(sql, params))[0].n;

/** I2: cada fila del historial encadena con la anterior y la última es el stock actual */
const historialEncadenado = async () => bd.sql(`
    WITH h AS (SELECT h.*, LAG(stock_resultante) OVER (PARTITION BY id_inventario ORDER BY id_historial) AS anterior,
                      ROW_NUMBER() OVER (PARTITION BY id_inventario ORDER BY id_historial DESC) AS desde_el_final
               FROM historial_inventario h)
    SELECT h.id_inventario, h.id_historial FROM h JOIN inventario_sucursal i USING (id_inventario)
    WHERE (h.anterior IS NOT NULL AND h.stock_resultante <> h.anterior
              + CASE WHEN h.tipo_movimiento = 'SALIDA' THEN -h.cantidad_movida ELSE h.cantidad_movida END)
       OR (h.desde_el_final = 1 AND h.stock_resultante <> i.cantidad_actual)`);

/** I3: entradas − salidas del historial = stock actual */
const conciliarStock = async (id_producto) => bd.sql(`
    SELECT i.id_sucursal, i.cantidad_actual,
           COALESCE(SUM(CASE WHEN h.tipo_movimiento = 'SALIDA' THEN -h.cantidad_movida ELSE h.cantidad_movida END), 0)::int AS por_historial
    FROM inventario_sucursal i LEFT JOIN historial_inventario h USING (id_inventario)
    WHERE i.id_producto = $1 GROUP BY i.id_inventario`, [id_producto]);

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idCentro }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Centro') RETURNING id_sucursal`);
    [{ id_sucursal: idSur }]    = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sur') RETURNING id_sucursal`);
    // Sin límites del menú QR por IP ni por mesa (las pruebas piden mucho desde la misma máquina)
    await bd.sql(`UPDATE configuracion SET menu_max_pedidos_ip = 100, menu_max_pendientes_mesa = 10 WHERE id_configuracion = 1`);
    [{ hoy, manana }] = await bd.sql(`SELECT (NOW() AT TIME ZONE 'America/La_Paz')::date::text AS hoy,
                                             ((NOW() AT TIME ZONE 'America/La_Paz')::date + 1)::text AS manana`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Concurrencia: el último producto lo obtiene uno solo', () => {
    let cajero;
    before(async () => { cajero = await crearCajero(1); });

    test('10 ventas simultáneas con stock 5 → 5 ventas, stock 0 y 5 salidas en el historial', async () => {
        const p = await crearProducto(5);
        const r = await Promise.all(Array.from({ length: 10 }, () => cobrar(cajero, [{ id_producto: p, cantidad: 1 }])));
        assert.equal(r.filter(x => x.status === 201).length, 5, JSON.stringify(r.map(x => x.status)));
        assert.ok(r.filter(x => x.status !== 201).every(x => x.status === 409 && x.body.error === 'STOCK_INSUFICIENTE'));
        assert.equal(await stock(p), 0);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM historial_inventario h JOIN inventario_sucursal i USING (id_inventario)
                                   WHERE i.id_producto = $1 AND h.motivo_movimiento = 'Venta en Caja'`, [p]), 5);
    });

    test('10 pedidos QR simultáneos con stock 5 → 5 pedidos y stock 0', async () => {
        const p = await crearProducto(5);
        const mesas = await Promise.all(Array.from({ length: 10 }, () => crearMesa(1)));
        const r = await Promise.all(mesas.map(m => pedir(m.codigo_qr, [{ id_producto: p, cantidad: 1 }])));
        assert.equal(r.filter(x => x.status === 201).length, 5, JSON.stringify(r.map(x => [x.status, x.body?.error])));
        assert.ok(r.filter(x => x.status !== 201).every(x => x.status === 409));
        assert.equal(await stock(p), 0);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM detalle_pedido WHERE id_producto = $1`, [p]), 5);
    });

    test('caja y menú QR mezclados con stock 5 → 5 en total y stock 0', async () => {
        const p = await crearProducto(5);
        const mesas = await Promise.all(Array.from({ length: 5 }, () => crearMesa(1)));
        const r = await Promise.all([
            ...Array.from({ length: 5 }, () => cobrar(cajero, [{ id_producto: p, cantidad: 1 }])),
            ...mesas.map(m => pedir(m.codigo_qr, [{ id_producto: p, cantidad: 1 }]))
        ]);
        assert.equal(r.filter(x => x.status === 201).length, 5, JSON.stringify(r.map(x => x.status)));
        assert.equal(await stock(p), 0);
        assert.deepEqual(await historialEncadenado(), []);
    });
});

describe('Doble envío: una sola operación', () => {
    let cajero;
    before(async () => { cajero = await crearCajero(1); });

    test('cerrar la misma cuenta dos veces a la vez → una sola venta', async () => {
        const p = await crearProducto(10);
        const { id_mesa } = await crearMesa(1);
        const id_cuenta = await abrirCuenta(cajero, id_mesa);
        assert.equal((await agregar(cajero, id_cuenta, p, 2)).status, 201);
        const cerrar = () => api('POST', `/cuentas/${id_cuenta}/cerrar`, { token: cajero.token, body: { metodo_pago: 'Efectivo' } });
        const r = await Promise.all([cerrar(), cerrar()]);
        assert.equal(r.filter(x => x.status === 200).length, 1, JSON.stringify(r.map(x => x.status)));
        assert.equal(await contar(`SELECT COUNT(DISTINCT id_venta)::int AS n FROM detalle_cuenta WHERE id_cuenta = $1`, [id_cuenta]), 1);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM detalle_venta WHERE id_producto = $1`, [p]), 1);
        assert.equal(await stock(p), 8, 'el stock reservado no se vuelve a descontar al cobrar');
    });

    test('confirmar el mismo pedido dos veces → pasa una sola vez a la cuenta', async () => {
        const p = await crearProducto(10);
        const mesa = await crearMesa(1);
        const ped = await pedir(mesa.codigo_qr, [{ id_producto: p, cantidad: 3 }]);
        assert.equal(ped.status, 201);
        const id = ped.body.id_pedido;
        const confirmar = () => api('POST', `/pedidos/${id}/confirmar`, { token: cajero.token });
        const r = await Promise.all([confirmar(), confirmar()]);
        assert.equal(r.filter(x => x.status === 200).length, 1, JSON.stringify(r.map(x => x.status)));
        assert.ok(r.some(x => x.status === 409));
        assert.equal(await contar(`SELECT COALESCE(SUM(cantidad), 0)::int AS n FROM detalle_cuenta WHERE id_producto = $1`, [p]), 3);
        assert.equal(await stock(p), 7, 'confirmar no vuelve a descontar');
    });

    test('rechazar el mismo pedido dos veces → devuelve el stock una sola vez', async () => {
        const p = await crearProducto(10);
        const mesa = await crearMesa(1);
        const ped = await pedir(mesa.codigo_qr, [{ id_producto: p, cantidad: 4 }]);
        const id = ped.body.id_pedido;
        assert.equal(await stock(p), 6);
        const rechazar = () => api('POST', `/pedidos/${id}/rechazar`, { token: cajero.token, body: {} });
        const r = await Promise.all([rechazar(), rechazar()]);
        assert.equal(r.filter(x => x.status === 200).length, 1, JSON.stringify(r.map(x => x.status)));
        assert.equal(await stock(p), 10);
        assert.deepEqual(await historialEncadenado(), []);
    });

    test('cerrar la caja dos veces a la vez → un solo cierre con el efectivo correcto', async () => {
        const cajeroCierre = await crearCajero(1);
        const p = await crearProducto(10, 25);
        assert.equal((await cobrar(cajeroCierre, [{ id_producto: p, cantidad: 2 }])).status, 201);
        const cerrar = () => api('POST', '/caja/cerrar', { token: cajeroCierre.token, body: { efectivo_contado: 150 } });
        const r = await Promise.all([cerrar(), cerrar()]);
        assert.ok(r.every(x => x.status === 200));
        const turnos = await bd.sql(`SELECT estado_turno, monto_calculado::float8 AS esperado, diferencia::float8 AS diferencia
                                     FROM turno_caja WHERE id_usuario_cajero = $1`, [cajeroCierre.id]);
        assert.equal(turnos.length, 1);
        assert.equal(turnos[0].estado_turno, 'Cerrado');
        assert.equal(turnos[0].esperado, 150);
        assert.equal(turnos[0].diferencia, 0);
    });
});

describe('Rollback: si una línea falla, no queda nada', () => {
    test('una venta con la tercera línea sin stock no deja venta, detalle, stock ni historial', async () => {
        const cajero = await crearCajero(1);
        const a = await crearProducto(5), b = await crearProducto(5), c = await crearProducto(0);
        const antes = {
            ventas:    await contar(`SELECT COUNT(*)::int AS n FROM venta_caja`),
            detalle:   await contar(`SELECT COUNT(*)::int AS n FROM detalle_venta`),
            historial: await contar(`SELECT COUNT(*)::int AS n FROM historial_inventario`)
        };
        const r = await cobrar(cajero, [{ id_producto: a, cantidad: 2 }, { id_producto: b, cantidad: 1 }, { id_producto: c, cantidad: 1 }]);
        assert.equal(r.status, 409);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM venta_caja`), antes.ventas);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM detalle_venta`), antes.detalle);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM historial_inventario`), antes.historial);
        assert.equal(await stock(a), 5);
        assert.equal(await stock(b), 5);
    });
});

describe('Conciliación de stock (I2, I3) tras un escenario mixto', () => {
    test('entradas − salidas = stock en cada sucursal, y el historial encadena', async () => {
        const cajero = await crearCajero(1);
        const p = await crearProducto(40);

        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 2 }])).status, 201);          // venta
        const m1 = await crearMesa(1);
        const c1 = await abrirCuenta(cajero, m1.id_mesa);
        const linea = (await agregar(cajero, c1, p, 3)).body.detalle;                                   // reserva 3
        assert.equal((await api('PATCH', `/cuentas/detalle/${linea.id_detalle_cuenta}`,
                                { token: cajero.token, body: { cantidad: 1 } })).status, 200);          // devuelve 2
        assert.equal((await api('POST', `/cuentas/${c1}/cerrar`,
                                { token: cajero.token, body: { metodo_pago: 'QR' } })).status, 200);    // cobra sin descontar
        const m2 = await crearMesa(1);
        const rechazado = await pedir(m2.codigo_qr, [{ id_producto: p, cantidad: 2 }]);
        assert.equal((await api('POST', `/pedidos/${rechazado.body.id_pedido}/rechazar`,
                                { token: cajero.token, body: {} })).status, 200);                       // vuelve 2
        const confirmado = await pedir(m2.codigo_qr, [{ id_producto: p, cantidad: 1 }]);
        assert.equal((await api('POST', `/pedidos/${confirmado.body.id_pedido}/confirmar`,
                                { token: cajero.token })).status, 200);
        const mover = (tipo, cantidad, motivo) => api('POST', '/inventario/movimientos',
            { token: cajero.token, body: { id_sucursal: 1, id_producto: p, tipo, cantidad, motivo } });
        assert.equal((await mover('SALIDA', 1, 'Dañado')).status, 201);                                 // merma
        assert.equal((await mover('INGRESO', 4, 'Producción')).status, 201);                           // entrada
        assert.equal((await api('POST', '/inventario/transferencias', { token: cajero.token,
            body: { id_sucursal_destino: idSur, items: [{ id_producto: p, cantidad: 5 }] } })).status, 201);
        const m3 = await crearMesa(1);
        const c3 = await abrirCuenta(cajero, m3.id_mesa);
        assert.equal((await agregar(cajero, c3, p, 2)).status, 201);
        assert.equal((await api('POST', '/cuentas/reset-mesa', { token: tAdmin, body: { id_mesa: m3.id_mesa } })).status, 200);

        // 40 − 2 (venta) − 1 (mesa) − 1 (pedido confirmado) − 1 (merma) + 4 − 5 (transferencia) = 34
        assert.equal(await stock(p), 34);
        assert.equal(await stock(p, idSur), 5);
        for (const fila of await conciliarStock(p)) assert.equal(fila.por_historial, fila.cantidad_actual, JSON.stringify(fila));
        assert.deepEqual(await historialEncadenado(), []);
        assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM inventario_sucursal WHERE cantidad_actual < 0`), 0);
    });
});

describe('Redondeo: detalle y cabecera coinciden al centavo', () => {
    test('precios 7,33 y 12,99 con promoción del 15 % y descuentos del 15 % y 33 %', async () => {
        const cajero = await crearCajero(1);
        const a = await crearProducto(1000, 7.33), b = await crearProducto(1000, 12.99);
        const promo = await api('POST', '/promociones', { token: tAdmin, body: {
            nombre: 'Redondeo', tipo: 'PORCENTAJE', valor: 15, fecha_inicio: hoy, fecha_fin: manana, id_sucursal: 1,
            productos: [{ id_producto: a }] } });
        assert.equal(promo.status, 201, JSON.stringify(promo.body));

        const ids = [];
        for (const qa of [1, 2, 3, 7]) for (const qb of [1, 3, 5]) for (const pct of [0, 15, 33]) {
            const descuento = pct ? { tipo: 'PORCENTAJE', valor: pct, motivo: 'Prueba de redondeo' } : undefined;
            const r = await cobrar(cajero, [{ id_producto: a, cantidad: qa }, { id_producto: b, cantidad: qb }], 'Efectivo', descuento);
            assert.equal(r.status, 201, JSON.stringify(r.body));
            // Cálculo independiente en centavos
            const brutoA = 733 * qa, brutoB = 1299 * qb;
            const promoA = Math.round(qa * 733 * 15 / 100);
            const manual = Math.round((brutoA + brutoB - promoA) * pct / 100);
            assert.equal(centavos(r.body.cotizacion.total), brutoA + brutoB - promoA - manual, `${qa}×7,33 ${qb}×12,99 −${pct} %`);
            ids.push(r.body.id_venta);
        }
        const descuadres = await bd.sql(`
            SELECT v.id_venta FROM venta_caja v JOIN detalle_venta d USING (id_venta)
            WHERE v.id_venta = ANY($1::int[]) GROUP BY v.id_venta
            HAVING v.monto_total_venta <> SUM(d.subtotal_venta)
                OR v.monto_total_venta <> SUM(d.precio_unitario * d.cantidad_vendida) - v.descuento_promociones - v.descuento_manual
                OR v.descuento_promociones <> SUM(d.descuento_promocion)
                OR v.descuento_manual <> SUM(d.descuento_manual)
                OR bool_or(d.subtotal_venta < 0)`, [ids]);
        assert.deepEqual(descuadres, []);
    });
});

describe('Conciliación de dinero: mesa con promoción, descuento y cobro por persona', () => {
    test('las ventas suman lo esperado al centavo y Panel, Informes y Arqueo dan el mismo total', async () => {
        const cajero = await crearCajero(idCentro);
        const torta = await crearProducto(50, 7.33, idCentro), cafe = await crearProducto(50, 12.99, idCentro);
        const promo = await api('POST', '/promociones', { token: tAdmin, body: {
            nombre: 'Café 15', tipo: 'PORCENTAJE', valor: 15, fecha_inicio: hoy, fecha_fin: manana, id_sucursal: idCentro,
            productos: [{ id_producto: cafe }] } });
        assert.equal(promo.status, 201, JSON.stringify(promo.body));

        const mesa = await crearMesa(idCentro);
        const ana = celularAzar(), beto = celularAzar();
        for (const [cliente, items] of [[ana, [{ id_producto: torta, cantidad: 2 }, { id_producto: cafe, cantidad: 1 }]],
                                        [beto, [{ id_producto: cafe, cantidad: 3 }]]]) {
            const ped = await pedir(mesa.codigo_qr, items, { cliente_mesa: cliente });
            assert.equal(ped.status, 201, JSON.stringify(ped.body));
            assert.equal((await api('POST', `/pedidos/${ped.body.id_pedido}/confirmar`, { token: cajero.token })).status, 200);
        }
        const [{ id_cuenta }] = await bd.sql(`SELECT id_cuenta FROM cuenta_mesa WHERE id_mesa = $1 AND estado = 'Abierta'`, [mesa.id_mesa]);
        assert.equal((await agregar(cajero, id_cuenta, torta, 1)).status, 201);                         // lo del cajero

        const cerrar = (body) => api('POST', `/cuentas/${id_cuenta}/cerrar`, { token: cajero.token, body });
        const rAna  = await cerrar({ metodo_pago: 'Efectivo', cliente_mesa: ana,
                                     descuento: { tipo: 'PORCENTAJE', valor: 33, motivo: 'Cliente frecuente' } });
        const rBeto = await cerrar({ metodo_pago: 'QR', cliente_mesa: beto });
        const rResto = await cerrar({ metodo_pago: 'Efectivo' });
        for (const r of [rAna, rBeto, rResto]) assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(rResto.body.cuenta_cerrada, true);

        // Esperado en centavos: Ana 2×7,33 + 1×12,99 (−15 % café) −33 %; Beto 3×12,99 (−15 %); cajero 1×7,33
        const anaBruto = 2 * 733 + 1299, anaPromo = Math.round(1299 * 15 / 100);
        const ana$ = anaBruto - anaPromo - Math.round((anaBruto - anaPromo) * 33 / 100);
        const beto$ = 3 * 1299 - Math.round(3 * 1299 * 15 / 100);
        const cajero$ = 733;
        assert.equal(centavos(rAna.body.total), ana$);
        assert.equal(centavos(rBeto.body.total), beto$);
        assert.equal(centavos(rResto.body.total), cajero$);
        const esperado = ana$ + beto$ + cajero$;

        const [{ suma }] = await bd.sql(`SELECT SUM(monto_total_venta) AS suma FROM venta_caja WHERE id_sucursal = $1`, [idCentro]);
        assert.equal(centavos(suma), esperado);
        const [{ pendiente }] = await bd.sql(
            `SELECT COUNT(*)::int AS pendiente FROM detalle_cuenta WHERE id_cuenta = $1 AND id_venta IS NULL`, [id_cuenta]);
        assert.equal(pendiente, 0);

        const panel   = await api('GET', `/reportes/dashboard-completo/${idCentro}`, { token: tAdmin });
        const informe = await api('GET', `/reportes/periodo/${idCentro}?fecha_inicio=${hoy}&fecha_fin=${hoy}`, { token: tAdmin });
        const arqueo  = await api('GET', `/caja/arqueo/${idCentro}`, { token: cajero.token });
        assert.equal(centavos(panel.body.hoy.ingresos), esperado, 'Panel');
        assert.equal(centavos(informe.body.resumen.ingresos_totales), esperado, 'Informes');
        assert.equal(centavos(arqueo.body.turno_resumen.total), esperado, 'Arqueo');
        assert.equal(centavos(arqueo.body.turno_resumen.efectivo_esperado), 10000 + ana$ + cajero$, 'efectivo esperado');
    });
});

describe('Medianoche (hora de La Paz)', () => {
    test('una venta de las 23:59 queda en el turno de ayer, la de las 00:01 en el de hoy, y el cierre automático suma igual', async () => {
        const cajero = await crearCajero(idSur);
        const p = await crearProducto(20, 10, idSur);
        // El turno se abrió ayer a las 22:00 y tuvo una venta a las 23:59
        await bd.sql(`UPDATE turno_caja SET fecha_hora_apertura = CURRENT_DATE - INTERVAL '2 hours' WHERE id_turno = $1`, [cajero.id_turno]);
        await bd.sql(`INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_turno, monto_total_venta, metodo_pago, fecha_venta)
                      VALUES ($1, $2, $3, 30, 'Efectivo', CURRENT_DATE - INTERVAL '1 minute')`, [idSur, cajero.id, cajero.id_turno]);

        // 00:01: el cierre automático todavía no corrió → la venta no entra al turno de ayer
        const tarde = await cobrar(cajero, [{ id_producto: p, cantidad: 1 }]);
        assert.equal(tarde.status, 403);

        const cierreDiario = require('../../src/procesos/cierreDiario');
        await cierreDiario.ejecutar();
        const [t] = await bd.sql(`SELECT estado_turno, cerrado_por, monto_calculado::float8 AS esperado,
                                         fecha_hora_cierre = CURRENT_DATE::timestamp AS a_medianoche
                                  FROM turno_caja WHERE id_turno = $1`, [cajero.id_turno]);
        assert.equal(t.estado_turno, 'Cerrado');
        assert.equal(t.cerrado_por, 'Sistema');
        assert.equal(t.esperado, 130, 'fondo 100 + venta de las 23:59');
        assert.equal(t.a_medianoche, true);

        // Hoy abre otra caja y vende: va al turno nuevo y al Panel de hoy
        const r = await api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal: idSur, monto_inicial: 0 } });
        assert.equal(r.status, 201);
        const venta = await cobrar(cajero, [{ id_producto: p, cantidad: 1 }]);
        assert.equal(venta.status, 201);
        const [v] = await bd.sql(`SELECT id_turno FROM venta_caja WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.equal(v.id_turno, r.body.turno.id_turno);
        const panel = await api('GET', `/reportes/dashboard-completo/${idSur}`, { token: tAdmin });
        assert.equal(panel.body.hoy.ingresos, 10, 'la venta de las 23:59 no cuenta como de hoy');
    });
});

describe('Tiempo real: el stock se avisa una vez y después del COMMIT', () => {
    test('una venta emite un evento por producto con el stock ya guardado; un rollback no emite nada', async () => {
        const cajero = await crearCajero(1);
        const a = await crearProducto(9), b = await crearProducto(9), sinStock = await crearProducto(0);
        const lector = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
                                    password: process.env.DB_PASSWORD, database: bd.nombre });
        await lector.connect();
        const eventos = [];
        const original = global.io.emit.bind(global.io);
        global.io.emit = (evento, datos) => {
            if (evento === 'actualizacion_stock_global') {
                // Lo que ve otra conexión en el momento del aviso: si fuera antes del COMMIT, vería el stock viejo
                eventos.push(lector.query(`SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`,
                                          [datos.id_producto, datos.id_sucursal])
                                   .then(r => ({ ...datos, en_bd: r.rows[0].cantidad_actual })));
            }
            return original(evento, datos);
        };
        try {
            const ok = await cobrar(cajero, [{ id_producto: a, cantidad: 2 }, { id_producto: b, cantidad: 3 }]);
            assert.equal(ok.status, 201);
            const avisos = await Promise.all(eventos.splice(0));
            assert.equal(avisos.length, 2, 'un aviso por producto');
            assert.deepEqual(avisos.map(e => [e.id_producto, e.nueva_cantidad_disponible]).sort(), [[a, 7], [b, 6]].sort());
            assert.ok(avisos.every(e => e.en_bd === e.nueva_cantidad_disponible), JSON.stringify(avisos));

            const falla = await cobrar(cajero, [{ id_producto: a, cantidad: 1 }, { id_producto: sinStock, cantidad: 1 }]);
            assert.equal(falla.status, 409);
            assert.equal(eventos.length, 0, 'con rollback no se avisa nada');
            assert.equal(await stock(a), 7);
        } finally {
            global.io.emit = original;
            await lector.end();
        }
    });
});
