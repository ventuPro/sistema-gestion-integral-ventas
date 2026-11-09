const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Promociones y descuento manual ───
// Levantan el backend real contra una BD temporal.

let bd, servidor, io, pool, URL_BASE;
const CLAVE = 'Prueba123';

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

const crearUsuario = async (correo, id_rol, id_sucursal = 1) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, $2, $3, $3, $4) RETURNING id_usuario`, [id_sucursal, id_rol, correo, hash]);
    return u.id_usuario;
};

/** Categoría propia por prueba: así las promociones de una no afectan a otra */
const crearCategoria = async (nombre) =>
    (await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ($1) RETURNING id_categoria`, [nombre]))[0].id_categoria;

const crearProducto = async (nombre, precio, id_categoria, stock = 50, id_sucursal = 1) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario) VALUES ($1, $2, $3) RETURNING id_producto`,
        [id_categoria, nombre, precio]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, $3)`,
                 [id_sucursal, p.id_producto, stock]);
    return p.id_producto;
};

let tAdmin, tCajero, tCajeroSinPermiso, tCajeroOtra, idOtraSucursal, hoy, manana, diaHoy;

const promo = (extra) => ({ nombre: 'Promo de prueba', tipo: 'PORCENTAJE', valor: 10, fecha_inicio: hoy, fecha_fin: manana, ...extra });
const crearPromo = async (token, extra) => {
    const r = await api('POST', '/promociones', { token, body: promo(extra) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.promocion;
};
const cotizar = (token, detalles, descuento) => api('POST', '/caja/cotizar', { token, body: { detalles, descuento } });

before(async () => {
    bd = await crearBdPrueba();
    [{ id_sucursal: idOtraSucursal }] = await bd.sql(
        `INSERT INTO sucursal (nombre_sucursal) VALUES ('Otra sucursal') RETURNING id_sucursal`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    // Fecha y día según la zona del sistema (La Paz), igual que el motor
    ({ rows: [{ hoy, manana, dia: diaHoy }] } = await pool.query(
        `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS hoy, to_char(CURRENT_DATE + 1, 'YYYY-MM-DD') AS manana,
                EXTRACT(ISODOW FROM NOW())::int AS dia`));

    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    const idCajero = await crearUsuario('cajero.promo@prueba.com', 2);
    const idOtra   = await crearUsuario('cajero.otra@prueba.com', 2, idOtraSucursal);
    await crearUsuario('cajero.sinpromo@prueba.com', 2);
    for (const id of [idCajero, idOtra]) {
        const r = await api('PUT', `/permisos/usuario/${id}`,
            { token: tAdmin, body: { permisos: { promociones: true, punto_venta: true, mesas: true } } });
        assert.equal(r.status, 200);
    }
    tCajero           = await iniciarSesion('cajero.promo@prueba.com', CLAVE);
    tCajeroOtra       = await iniciarSesion('cajero.otra@prueba.com', CLAVE);
    tCajeroSinPermiso = await iniciarSesion('cajero.sinpromo@prueba.com', CLAVE);
    const turno = await api('POST', '/caja/turnos/abrir', { token: tCajero, body: { id_sucursal: 1, monto_inicial: 100 } });
    assert.equal(turno.status, 201);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Promociones: acceso y gestión', () => {
    test('es un módulo de permisos: apagado por defecto para el cajero', async () => {
        assert.equal((await api('GET', '/promociones', { token: tCajeroSinPermiso })).status, 403);
        const r = await api('GET', '/permisos/mis-permisos', { token: tCajeroSinPermiso });
        assert.equal(r.body.permisos.promociones, false);
        assert.equal((await api('GET', '/promociones', { token: tCajero })).status, 200);
    });

    test('valida los datos y el precio especial contra el precio normal', async () => {
        const cat = await crearCategoria('Validación');
        const id = await crearProducto('Cuñapé', 3, cat);
        const caro = await api('POST', '/promociones', { token: tAdmin, body: promo({ tipo: 'PRECIO', valor: 3, productos: [{ id_producto: id }] }) });
        assert.equal(caro.status, 400);
        assert.match(caro.body.error, /menor al precio normal/);
        assert.equal((await api('POST', '/promociones', { token: tAdmin, body: promo({ categorias: [] }) })).status, 400);
    });

    test('el cajero gestiona solo las de su sucursal; las globales solo el administrador', async () => {
        const cat = await crearCategoria('Alcance');
        const global = await crearPromo(tAdmin, { categorias: [cat] });
        assert.equal(global.id_sucursal, null);

        const propia = await crearPromo(tCajero, { categorias: [cat], id_sucursal: idOtraSucursal });
        assert.equal(propia.id_sucursal, 1, 'se fuerza a la sucursal del cajero');
        assert.equal(propia.editable, true);

        const lista = (await api('GET', '/promociones', { token: tCajero })).body;
        assert.equal(lista.find(p => p.id_promocion === global.id_promocion).editable, false);
        assert.equal((await api('PATCH', `/promociones/${global.id_promocion}/estado`, { token: tCajero, body: { activa: false } })).status, 403);
        assert.equal((await api('PATCH', `/promociones/${propia.id_promocion}/estado`, { token: tCajeroOtra, body: { activa: false } })).status, 403);
        assert.equal((await api('GET', '/promociones', { token: tCajeroOtra })).body.some(p => p.id_promocion === propia.id_promocion), false);
    });
});

describe('Promociones: precios al cobrar', () => {
    test('el punto de venta cobra con la promoción y la registra en la venta', async () => {
        const cat = await crearCategoria('Tortas POS');
        const id = await crearProducto('Torta POS', 50, cat, 10);
        const p = await crearPromo(tAdmin, { nombre: 'Tortas -20 %', valor: 20, categorias: [cat] });

        const c = await cotizar(tCajero, [{ id_producto: id, cantidad: 2 }]);
        assert.equal(c.status, 200);
        assert.equal(c.body.subtotal_bruto, 100);
        assert.equal(c.body.descuento_promociones, 20);
        assert.equal(c.body.total, 80);
        assert.deepEqual(c.body.items[0].promociones, ['Tortas -20 %']);

        const venta = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: 80, detalles: [{ id_producto: id, cantidad: 2 }] } });
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        const [v] = await bd.sql(`SELECT monto_total_venta::float8 AS total, descuento_promociones::float8 AS promo FROM venta_caja WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.deepEqual(v, { total: 80, promo: 20 });
        const [d] = await bd.sql(`SELECT precio_unitario::float8 AS precio, subtotal_venta::float8 AS subtotal, descuento_promocion::float8 AS descuento, id_promocion
                                  FROM detalle_venta WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.deepEqual(d, { precio: 50, subtotal: 80, descuento: 20, id_promocion: p.id_promocion });
        const [{ cantidad_actual }] = await bd.sql(`SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = 1`, [id]);
        assert.equal(cantidad_actual, 8);
    });

    test('si el total que vio el cajero ya no vale, rechaza con la cotización nueva', async () => {
        const cat = await crearCategoria('Cambio de precio');
        const id = await crearProducto('Queque', 10, cat);
        await crearPromo(tAdmin, { valor: 50, categorias: [cat] });
        const r = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: 30, detalles: [{ id_producto: id, cantidad: 3 }] } });
        assert.equal(r.status, 409);
        assert.equal(r.body.error, 'PRECIO_DESACTUALIZADO');
        assert.equal(r.body.cotizacion.total, 15);
    });

    test('3×2 y combo por la API', async () => {
        const cat = await crearCategoria('Combos');
        const cafe = await crearProducto('Café', 8, cat), porcion = await crearProducto('Porción', 12, cat), emp = await crearProducto('Empanada', 5, cat);
        await crearPromo(tAdmin, { tipo: 'NXM', lleva: 3, paga: 2, productos: [{ id_producto: emp }] });
        await crearPromo(tAdmin, { tipo: 'COMBO', valor: 15, productos: [{ id_producto: cafe, cantidad: 1 }, { id_producto: porcion, cantidad: 1 }] });
        const c = await cotizar(tCajero, [{ id_producto: emp, cantidad: 3 }, { id_producto: cafe, cantidad: 1 }, { id_producto: porcion, cantidad: 1 }]);
        assert.equal(c.body.descuento_promociones, 5 + 5);
        assert.equal(c.body.total, 10 + 15);   // empanadas 3×2 + combo
    });

    test('no aplica promociones inactivas, de otro día, fuera de hora ni de otra sucursal', async () => {
        const cat = await crearCategoria('Vigencia');
        const id = await crearProducto('Pan', 10, cat);
        const otroDia = diaHoy === 7 ? 1 : diaHoy + 1;
        const inactiva = await crearPromo(tAdmin, { valor: 50, categorias: [cat] });
        await api('PATCH', `/promociones/${inactiva.id_promocion}/estado`, { token: tAdmin, body: { activa: false } });
        await crearPromo(tAdmin, { valor: 40, categorias: [cat], dias_semana: [otroDia] });
        await crearPromo(tAdmin, { valor: 30, categorias: [cat], id_sucursal: idOtraSucursal });
        const [{ desde, hasta }] = (await pool.query(
            `SELECT to_char(LOCALTIME + interval '2 hours', 'HH24:MI') AS desde, to_char(LOCALTIME + interval '3 hours', 'HH24:MI') AS hasta`)).rows;
        await crearPromo(tAdmin, { valor: 20, categorias: [cat], hora_inicio: desde, hora_fin: hasta });
        await crearPromo(tAdmin, { valor: 5, categorias: [cat], dias_semana: [diaHoy] });

        const c = await cotizar(tCajero, [{ id_producto: id, cantidad: 1 }]);
        assert.equal(c.body.descuento_promociones, 0.5, 'solo vale la del 5 % de hoy');
    });
});

describe('Descuento manual', () => {
    test('el cajero descuenta sin tope (90 % o casi todo en bolivianos) con motivo obligatorio', async () => {
        const cat = await crearCategoria('Manual');
        const id = await crearProducto('Alfajor', 100, cat);
        const det = [{ id_producto: id, cantidad: 1 }];

        const pct = await cotizar(tCajero, det, { tipo: 'PORCENTAJE', valor: 90, motivo: 'Cliente frecuente' });
        assert.equal(pct.status, 200);
        assert.equal(pct.body.total, 10);
        const bs = await cotizar(tCajero, det, { tipo: 'MONTO', valor: 99.5, motivo: 'Casi todo' });
        assert.equal(bs.body.total, 0.5);
        assert.equal((await cotizar(tCajero, det, { tipo: 'MONTO', valor: 101, motivo: 'Más que el total' })).status, 400);
        assert.equal((await cotizar(tCajero, det, { tipo: 'MONTO', valor: 5, motivo: '' })).status, 400);
    });

    test('se guarda en la venta con su motivo', async () => {
        const cat = await crearCategoria('Manual venta');
        const id = await crearProducto('Brazo gitano', 40, cat);
        const venta = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: 36, detalles: [{ id_producto: id, cantidad: 1 }],
            descuento: { tipo: 'MONTO', valor: 4, motivo: 'Producto golpeado' } } });
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        const [v] = await bd.sql(`SELECT descuento_manual::float8 AS d, motivo_descuento AS m FROM venta_caja WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.deepEqual(v, { d: 4, m: 'Producto golpeado' });

    });
});

describe('Promociones en mesas', () => {
    test('la cuenta se cotiza y se cobra con la promoción', async () => {
        const cat = await crearCategoria('Mesas');
        const id = await crearProducto('Jugo', 10, cat);
        await crearPromo(tAdmin, { tipo: 'NXM', lleva: 2, paga: 1, productos: [{ id_producto: id }] });
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 77, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 1 } });
        await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 1 } });

        const c = await api('GET', `/cuentas/${cuenta.id_cuenta}/cotizacion`, { token: tCajero });
        assert.equal(c.status, 200);
        assert.equal(c.body.total, 10);

        // La tarjeta de la mesa muestra lo mismo que la cuenta (con la promoción), en las dos listas
        for (const ruta of ['/cuentas/mesas/1', '/mesas/sucursal/1']) {
            const m = (await api('GET', ruta, { token: tCajero })).body.find(x => x.id_mesa === mesa.id_mesa);
            assert.equal(Number(m.total_acumulado), 10, ruta);
        }

        const cierre = await api('POST', `/cuentas/${cuenta.id_cuenta}/cerrar`, { token: tCajero, body: { metodo_pago: 'Efectivo' } });
        assert.equal(cierre.status, 200, JSON.stringify(cierre.body));
        assert.equal(cierre.body.total, 10);
        const [v] = await bd.sql(`SELECT monto_total_venta::float8 AS t, descuento_promociones::float8 AS p FROM venta_caja WHERE id_venta = $1`, [cierre.body.id_venta]);
        assert.deepEqual(v, { t: 10, p: 10 });
    });

    test('descuento manual en mesas: se valida al cotizar y se guarda al cobrar', async () => {
        const cat = await crearCategoria('Mesa descuento');
        const id = await crearProducto('Té', 20, cat);
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 78, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 5 } });

        const mucho = await api('POST', `/cuentas/${cuenta.id_cuenta}/cotizar`, { token: tCajero,
            body: { descuento: { tipo: 'MONTO', valor: 150, motivo: 'Más que el total' } } });
        assert.equal(mucho.status, 400);
        const casi = await api('POST', `/cuentas/${cuenta.id_cuenta}/cotizar`, { token: tCajero,
            body: { descuento: { tipo: 'PORCENTAJE', valor: 90, motivo: 'Cumpleaños' } } });
        assert.equal(casi.body.total, 10);
        const ok = await api('POST', `/cuentas/${cuenta.id_cuenta}/cotizar`, { token: tCajero,
            body: { descuento: { tipo: 'MONTO', valor: 10, motivo: 'Cumpleaños' } } });
        assert.equal(ok.body.total, 90);

        const cierre = await api('POST', `/cuentas/${cuenta.id_cuenta}/cerrar`, { token: tCajero,
            body: { metodo_pago: 'Efectivo', descuento: { tipo: 'MONTO', valor: 10, motivo: 'Cumpleaños' } } });
        assert.equal(cierre.status, 200, JSON.stringify(cierre.body));
        const [v] = await bd.sql(`SELECT monto_total_venta::float8 AS t, descuento_manual::float8 AS d, motivo_descuento AS m
                                  FROM venta_caja WHERE id_venta = $1`, [cierre.body.id_venta]);
        assert.deepEqual(v, { t: 90, d: 10, m: 'Cumpleaños' });
    });

    test('una promoción usada no se elimina: se desactiva', async () => {
        const usada = (await api('GET', '/promociones', { token: tAdmin })).body.find(p => p.usos > 0);
        assert.ok(usada);
        assert.equal((await api('DELETE', `/promociones/${usada.id_promocion}`, { token: tAdmin })).status, 400);
        const cat = await crearCategoria('Borrable');
        const nueva = await crearPromo(tAdmin, { categorias: [cat] });
        assert.equal((await api('DELETE', `/promociones/${nueva.id_promocion}`, { token: tAdmin })).status, 200);
    });
});

describe('Totales por cobrar con promociones', () => {
    test('cada cliente de la mesa ve lo suyo con promociones de cualquier tipo, el panel y la bandeja también', async () => {
        const cat = await crearCategoria('Por cobrar');
        const cafe = await crearProducto('Cafe PC', 5, cat), croa = await crearProducto('Croasant PC', 5, cat);
        const emp1 = await crearProducto('Empanada PC 1', 3.5, cat), emp2 = await crearProducto('Empanada PC 2', 3.5, cat);
        const jugo = await crearProducto('Jugo PC', 10, cat);
        await crearPromo(tAdmin, { nombre: 'Combo PC', tipo: 'COMBO', valor: 8.5, productos: [{ id_producto: cafe, cantidad: 1 }, { id_producto: croa, cantidad: 1 }] });
        await crearPromo(tAdmin, { nombre: 'Tres por dos PC', tipo: 'NXM', lleva: 3, paga: 2, productos: [{ id_producto: emp1 }, { id_producto: emp2 }] });
        await crearPromo(tAdmin, { nombre: 'Jugo PC 20', tipo: 'PORCENTAJE', valor: 20, productos: [{ id_producto: jugo }] });

        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 83, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        const linea = async (cliente, id_producto, cantidad, precio) => {
            let id_pedido = null;
            if (cliente) [{ id_pedido }] = await bd.sql(`INSERT INTO pedido_mesa (id_sucursal, id_mesa, id_cuenta, cliente_mesa, estado_pedido)
                                                       VALUES (1, $1, $2, $3, 'Confirmado') RETURNING id_pedido`, [mesa.id_mesa, cuenta.id_cuenta, cliente]);
            await bd.sql(`INSERT INTO detalle_cuenta (id_cuenta, id_producto, cantidad, precio_unitario, id_pedido) VALUES ($1, $2, $3, $4, $5)`,
                         [cuenta.id_cuenta, id_producto, cantidad, precio, id_pedido]);
        };
        const a = 'a'.repeat(32), b = 'b'.repeat(32);
        await linea(a, cafe, 1, 5); await linea(a, croa, 1, 5);          // combo: 10 → 8,50
        await linea(b, emp1, 2, 3.5); await linea(b, emp2, 1, 3.5);      // 3×2 combinado: 10,50 → 7
        await linea(null, jugo, 1, 10);                                  // cajero, 20 %: 10 → 8

        const c = (await api('POST', `/cuentas/${cuenta.id_cuenta}/cotizar`, { token: tCajero, body: {} })).body;
        const parte = (cliente) => c.partes.find(p => p.cliente_mesa === cliente).total;
        assert.deepEqual([parte(a), parte(b), parte(null)], [8.5, 7, 8]);
        for (const cliente of [a, b, null]) {
            const sola = (await api('POST', `/cuentas/${cuenta.id_cuenta}/cotizar`, { token: tCajero, body: { cliente_mesa: cliente } })).body;
            assert.equal(sola.total, parte(cliente), 'lo que se muestra es lo que se cobra');
            assert.equal(sola.partes, undefined);
        }

        const panel = (await api('GET', '/reportes/dashboard-completo/1', { token: tAdmin })).body;
        const lista = (await api('GET', '/cuentas/mesas/1', { token: tAdmin })).body;
        const enMesas = lista.filter(m => m.id_cuenta).reduce((s, m) => s + Number(m.total_acumulado), 0);
        assert.equal(panel.mesas.por_cobrar, Math.round(enMesas * 100) / 100);
        assert.equal(Number(lista.find(m => m.id_mesa === mesa.id_mesa).total_acumulado), 23.5);

        const [ped] = await bd.sql(`INSERT INTO pedido_mesa (id_sucursal, id_mesa, cliente_mesa, estado_pedido)
                                    VALUES (1, $1, $2, 'Pendiente_Cajero') RETURNING id_pedido`, [mesa.id_mesa, 'c'.repeat(32)]);
        await bd.sql(`INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad_solicitada, precio_aplicado) VALUES ($1, $2, 3, 3.5)`, [ped.id_pedido, emp1]);
        const bandeja = (await api('GET', '/pedidos/bandeja', { token: tCajero })).body;
        const p = bandeja.find(x => x.id_pedido === ped.id_pedido);
        assert.deepEqual([p.monto_lista, p.monto_total], [10.5, 7]);
    });
});

describe('Promociones en el menú QR', () => {
    test('catálogo con la promoción de cada producto, lista de hoy y total estimado del carrito', async () => {
        const cat = await crearCategoria('Menú QR');
        const torta = await crearProducto('Torta QR', 40, cat), jugo = await crearProducto('Jugo QR', 10, cat);
        await crearPromo(tAdmin, { nombre: 'Tortas -25 %', valor: 25, productos: [{ id_producto: torta }] });
        await crearPromo(tAdmin, { nombre: 'Jugos 2x1', tipo: 'NXM', lleva: 2, paga: 1, productos: [{ id_producto: jugo }] });
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 80, md5(random()::text)) RETURNING id_mesa, codigo_qr`);

        const catalogo = (await api('GET', `/menu/m/${mesa.codigo_qr}/catalogo`)).body;
        const t = catalogo.find(p => p.id_producto === torta), j = catalogo.find(p => p.id_producto === jugo);
        assert.deepEqual([t.promocion.nombre, t.promocion.precio_promocional], ['Tortas -25 %', 30]);
        assert.deepEqual([j.promocion.tipo, j.promocion.precio_promocional], ['NXM', null]);

        // Por categoría: cada producto de la categoría la muestra
        const bebidas = await crearCategoria('Bebidas QR'), refresco = await crearProducto('Refresco QR', 10, bebidas);
        await crearPromo(tAdmin, { nombre: 'Bebidas -20 %', valor: 20, categorias: [bebidas] });
        const r = (await api('GET', `/menu/m/${mesa.codigo_qr}/catalogo`)).body.find(p => p.id_producto === refresco);
        assert.deepEqual([r.promocion?.nombre, r.promocion?.precio_promocional], ['Bebidas -20 %', 8]);

        const lista = (await api('GET', `/menu/m/${mesa.codigo_qr}/promociones`)).body;
        assert.ok(lista.some(v => v.texto === 'Jugos 2x1: lleva 2 y paga 1 en Jugo QR'));

        const c = await api('POST', `/menu/m/${mesa.codigo_qr}/cotizar`, { body: { items: [{ id_producto: torta, cantidad: 1 }, { id_producto: jugo, cantidad: 2 }] } });
        assert.equal(c.status, 200);
        assert.equal(c.body.total, 30 + 10);
    });

    test('«Mi mesa» muestra lo pendiente con las promociones', async () => {
        const cat = await crearCategoria('Mi mesa');
        const id = await crearProducto('Empanada QR', 6, cat);
        await crearPromo(tAdmin, { nombre: 'Empanadas 3x2', tipo: 'NXM', lleva: 3, paga: 2, productos: [{ id_producto: id }] });
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 81, md5(random()::text)) RETURNING id_mesa, codigo_qr`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        const cliente = 'a'.repeat(32);
        const [pedido] = await bd.sql(`INSERT INTO pedido_mesa (id_sucursal, id_mesa, id_cuenta, cliente_mesa, estado_pedido)
                                       VALUES (1, $1, $2, $3, 'Confirmado') RETURNING id_pedido`, [mesa.id_mesa, cuenta.id_cuenta, cliente]);
        await bd.sql(`INSERT INTO detalle_cuenta (id_cuenta, id_producto, cantidad, precio_unitario, id_pedido)
                      VALUES ($1, $2, 3, 6, $3)`, [cuenta.id_cuenta, id, pedido.id_pedido]);

        const e = (await api('GET', `/menu/m/${mesa.codigo_qr}/estado?cliente=${cliente}`)).body;
        assert.equal(e.cuenta.mi_pendiente, 12);
        assert.equal(e.cuenta.mi_descuento, 6);
        assert.equal(e.cuenta.total_mesa, 12);
        assert.equal(e.cuenta.id_cuenta, undefined);
    });
});

describe('Reimpresión de comprobantes', () => {
    test('devuelve la venta como se cobró: precios de lista, promoción, descuento manual y mesa', async () => {
        const [{ id_usuario }] = await bd.sql(`SELECT id_usuario FROM usuario WHERE correo_electronico = 'cajero.promo@prueba.com'`);
        await api('PUT', `/permisos/usuario/${id_usuario}`,
            { token: tAdmin, body: { permisos: { promociones: true, punto_venta: true, mesas: true, arqueo: true } } });
        const cat = await crearCategoria('Reimpresión');
        const id = await crearProducto('Alfajor', 20, cat);
        await crearPromo(tAdmin, { nombre: 'Alfajores -25 %', valor: 25, productos: [{ id_producto: id }] });
        const detalles = [{ id_producto: id, cantidad: 2 }];
        const descuento = { tipo: 'MONTO', valor: 5, motivo: 'Cliente frecuente' };
        const c = await cotizar(tCajero, detalles, descuento);
        assert.equal(c.body.total, 25);
        const venta = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: c.body.total, descuento, detalles } });
        assert.equal(venta.status, 201, JSON.stringify(venta.body));

        const r = await api('GET', `/caja/ventas/${venta.body.id_venta}/comprobante`, { token: tCajero });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.id_venta, venta.body.id_venta);
        assert.deepEqual(r.body.items, [{ nombre_producto: 'Alfajor', cantidad: 2, precio_unitario: 20, subtotal: 40,
                                          descuento: 10, promocion: 'Alfajores -25 %' }]);
        assert.equal(r.body.total, 25);
        assert.equal(r.body.descuento_promociones, 10);
        assert.equal(r.body.descuento_manual, 5);
        assert.equal(r.body.motivo_descuento, 'Cliente frecuente');
        assert.equal(r.body.metodo, 'Efectivo');
        assert.equal(r.body.numero_mesa, undefined);

        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 64, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 1 } });
        const cierre = await api('POST', `/cuentas/${cuenta.id_cuenta}/cerrar`, { token: tCajero, body: { metodo_pago: 'Efectivo' } });
        assert.equal(cierre.status, 200, JSON.stringify(cierre.body));
        const m = await api('GET', `/caja/ventas/${cierre.body.id_venta}/comprobante`, { token: tAdmin });
        assert.equal(m.status, 200);
        assert.equal(m.body.numero_mesa, 64);
        assert.equal(m.body.items[0].cantidad, 1);
    });

    test('el cajero solo reimprime ventas de su sucursal; datos inválidos o sin sesión se rechazan', async () => {
        const id = await crearProducto('Brownie', 8, await crearCategoria('Reimpresión 2'));
        const venta = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: 8, detalles: [{ id_producto: id, cantidad: 1 }] } });
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        const ruta = `/caja/ventas/${venta.body.id_venta}/comprobante`;

        await crearUsuario('cajero.reimp.otra@prueba.com', 2, idOtraSucursal);
        const tOtra = await iniciarSesion('cajero.reimp.otra@prueba.com', CLAVE);
        assert.equal((await api('GET', ruta, { token: tOtra })).status, 404);
        assert.equal((await api('GET', ruta)).status, 401);
        assert.equal((await api('GET', '/caja/ventas/abc/comprobante', { token: tAdmin })).status, 400);
        assert.equal((await api('GET', '/caja/ventas/999999/comprobante', { token: tAdmin })).status, 404);
    });
});

describe('Promociones en informes', () => {
    test('el informe y el panel muestran lo ahorrado con promociones y los descuentos manuales', async () => {
        const inf = await api('GET', `/reportes/periodo/1?fecha_inicio=${hoy}&fecha_fin=${hoy}`, { token: tAdmin });
        assert.equal(inf.status, 200);
        const d = inf.body.descuentos;
        assert.ok(d.resumen.promociones > 0 && d.resumen.ventas_con_promocion > 0);
        assert.ok(d.promociones.some(p => p.nombre === 'Tortas -20 %' && p.ahorro === 20 && p.unidades === 2));
        assert.ok(d.por_cajero.some(c => c.cajero === 'cajero.promo@prueba.com' && c.descuento >= 4));
        assert.ok(d.manuales.some(m => m.motivo === 'Producto golpeado' && m.descuento === 4));

        const panel = await api('GET', '/reportes/dashboard-completo/1', { token: tAdmin });
        assert.ok(panel.body.promociones.vigentes > 0);
        assert.ok(panel.body.promociones.ahorro > 0);
        assert.ok(panel.body.promociones.descuentos >= 4);
    });
});

describe('Número del día', () => {
    test('las ventas se numeran desde 1 cada día y en cada sucursal, sin repetir aunque lleguen a la vez', async () => {
        const cat = await crearCategoria('Numeros del dia');
        const id = await crearProducto('Pan numerado', 5, cat, 100);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 20)`, [idOtraSucursal, id]);
        const maximo = async (suc) => (await bd.sql(`SELECT COALESCE(MAX(numero_dia), 0)::int AS n FROM venta_caja
                                                     WHERE id_sucursal = $1 AND fecha_venta::date = CURRENT_DATE`, [suc]))[0].n;
        const vender = (token, id_sucursal) => api('POST', '/caja/cobrar', { token, body: {
            id_sucursal, metodo_pago: 'Efectivo', monto_total_venta: 5, detalles: [{ id_producto: id, cantidad: 1 }] } });

        // Lo de ayer no cuenta para hoy
        await bd.sql(`INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_turno, monto_total_venta, metodo_pago, fecha_venta, numero_dia)
                      SELECT id_sucursal, id_usuario_cajero, id_turno, 5, 'Efectivo', CURRENT_DATE - 1 + TIME '12:00', 900
                      FROM venta_caja WHERE id_sucursal = 1 LIMIT 1`);
        const base = await maximo(1);
        const v1 = await vender(tCajero, 1), v2 = await vender(tCajero, 1);
        assert.equal(v1.status, 201, JSON.stringify(v1.body));
        assert.deepEqual([v1.body.numero_dia, v2.body.numero_dia], [base + 1, base + 2]);

        // A la vez: todos distintos y seguidos
        const juntas = await Promise.all(Array.from({ length: 6 }, () => vender(tCajero, 1)));
        assert.ok(juntas.every(r => r.status === 201), JSON.stringify(juntas.map(r => r.body)));
        assert.deepEqual(juntas.map(r => r.body.numero_dia).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8].map(n => base + n));

        // Otra sucursal lleva su propia cuenta
        const turno = await api('POST', '/caja/turnos/abrir', { token: tCajeroOtra, body: { id_sucursal: idOtraSucursal, monto_inicial: 50 } });
        assert.equal(turno.status, 201, JSON.stringify(turno.body));
        const baseOtra = await maximo(idOtraSucursal);
        const otra = await vender(tCajeroOtra, idOtraSucursal);
        assert.equal(otra.body.numero_dia, baseOtra + 1);

        // El comprobante lleva el número del día
        const comp = await api('GET', `/caja/ventas/${v2.body.id_venta}/comprobante`, { token: tCajero });
        assert.equal(comp.body.numero_dia, base + 2);
    });
});

describe('Reserva del carrito de caja', () => {
    const reservar = (token, id_producto, cantidad) => api('PUT', `/caja/reservas/${id_producto}`, { token, body: { cantidad } });
    const stockDe = async (id, suc = 1) => (await bd.sql(`SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`, [id, suc]))[0].cantidad_actual;
    const cobrar = (token, id_producto, cantidad, precio) => api('POST', '/caja/cobrar', { token, body: {
        id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: cantidad * precio, detalles: [{ id_producto, cantidad }] } });

    test('agregar al carrito descuenta el stock al momento y quitar lo devuelve a su lote', async () => {
        const cat = await crearCategoria('Reservas A');
        const id = await crearProducto('Pan reservado', 4, cat, 10);
        const r = await reservar(tCajero, id, 3);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body, { cantidad: 3, stock: 7 });
        assert.equal(await stockDe(id), 7);
        const [h] = await bd.sql(`SELECT motivo_movimiento, id_reserva FROM historial_inventario h JOIN inventario_sucursal i USING (id_inventario)
                                  WHERE i.id_producto = $1 ORDER BY id_historial DESC LIMIT 1`, [id]);
        assert.equal(h.motivo_movimiento, 'Venta en Caja');
        assert.ok(h.id_reserva);

        assert.equal((await reservar(tCajero, id, 1)).body.stock, 9);
        assert.equal(await stockDe(id), 9);
        const [{ lotes }] = await bd.sql(`SELECT SUM(l.cantidad_actual)::int AS lotes FROM lote_inventario l JOIN inventario_sucursal i USING (id_inventario)
                                          WHERE i.id_producto = $1`, [id]);
        assert.equal(lotes, 9, 'la suma de los lotes sigue siendo el stock');
        const g = await api('GET', '/caja/reservas', { token: tCajero });
        assert.deepEqual(g.body.find(x => x.id_producto === id), { id_producto: id, cantidad: 1 });
        assert.equal((await reservar(tCajero, id, 0)).body.stock, 10);
    });

    test('nadie más puede tomar lo reservado; al cobrar no se descuenta dos veces', async () => {
        const cat = await crearCategoria('Reservas B');
        const id = await crearProducto('Queque reservado', 6, cat, 5);
        assert.equal((await reservar(tCajero, id, 4)).status, 200);

        // Otra cajera (otra sucursal no tiene el producto) y una venta directa por más de lo libre
        const libre = await cobrar(tCajeroOtra, id, 2, 6);
        assert.notEqual(libre.status, 201);

        const venta = await cobrar(tCajero, id, 4, 6);
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        assert.equal(await stockDe(id), 1);
        const [res] = await bd.sql(`SELECT cantidad, id_venta FROM reserva_caja WHERE id_producto = $1`, [id]);
        assert.deepEqual(res, { cantidad: 4, id_venta: venta.body.id_venta });
        const [{ salidas }] = await bd.sql(`SELECT SUM(cantidad_movida)::int AS salidas FROM historial_inventario h JOIN inventario_sucursal i USING (id_inventario)
                                           WHERE i.id_producto = $1 AND tipo_movimiento = 'SALIDA'`, [id]);
        assert.equal(salidas, 4);
        assert.deepEqual((await api('GET', '/caja/reservas', { token: tCajero })).body.filter(x => x.id_producto === id), []);
    });

    test('se cobra más o menos de lo reservado y lo que no se vende vuelve', async () => {
        const cat = await crearCategoria('Reservas C');
        const a = await crearProducto('Alfajor reservado', 3, cat, 10);
        const b = await crearProducto('Eclair reservado', 5, cat, 10);
        await reservar(tCajero, a, 2);
        await reservar(tCajero, b, 3);   // no se cobra: vuelve al stock

        const venta = await cobrar(tCajero, a, 5, 3);   // 2 reservadas + 3 más
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        assert.equal(await stockDe(a), 5);
        assert.equal(await stockDe(b), 10);
        const [{ vendidas }] = await bd.sql(`SELECT cantidad_vendida AS vendidas FROM detalle_venta WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.equal(vendidas, 5);
    });

    test('no se reserva más de lo que hay; sin caja abierta no se reserva; lo olvidado vuelve solo', async () => {
        const cat = await crearCategoria('Reservas D');
        const id = await crearProducto('Torta reservada', 20, cat, 2);
        const mucho = await reservar(tCajero, id, 5);
        assert.equal(mucho.status, 409);
        assert.equal(mucho.body.maximo, 2);
        assert.equal(await stockDe(id), 2);

        assert.equal((await reservar(tCajeroSinPermiso, id, 1)).status, 403);

        assert.equal((await reservar(tCajero, id, 2)).status, 200);
        await bd.sql(`UPDATE reserva_caja SET fecha_actualizacion = LOCALTIMESTAMP - INTERVAL '31 minutes' WHERE id_producto = $1`, [id]);
        const cambios = await require('../../src/models/reservaModel').liberarVencidas();
        assert.ok(cambios.some(c => c.id_producto === id && c.nuevo_stock === 2));
        assert.equal(await stockDe(id), 2);
    });
});
