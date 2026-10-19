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
    test('el cajero tiene tope (10 % por defecto) y motivo obligatorio; el administrador no', async () => {
        const cat = await crearCategoria('Manual');
        const id = await crearProducto('Alfajor', 100, cat);
        const det = [{ id_producto: id, cantidad: 1 }];

        const ok = await cotizar(tCajero, det, { tipo: 'PORCENTAJE', valor: 10, motivo: 'Cliente frecuente' });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.total, 90);
        assert.equal(ok.body.descuento_max, 10);
        assert.equal((await cotizar(tCajero, det, { tipo: 'PORCENTAJE', valor: 15, motivo: 'Mucho' })).status, 400);
        assert.equal((await cotizar(tCajero, det, { tipo: 'MONTO', valor: 5, motivo: '' })).status, 400);

        const admin = await cotizar(tAdmin, det, { tipo: 'PORCENTAJE', valor: 50, motivo: 'Autorizado' });
        assert.equal(admin.body.total, 50);
        assert.equal(admin.body.descuento_max, null);
    });

    test('se guarda en la venta con su motivo y el tope sale de Ajustes', async () => {
        const cat = await crearCategoria('Manual venta');
        const id = await crearProducto('Brazo gitano', 40, cat);
        const venta = await api('POST', '/caja/cobrar', { token: tCajero, body: {
            id_sucursal: 1, metodo_pago: 'Efectivo', monto_total_venta: 36, detalles: [{ id_producto: id, cantidad: 1 }],
            descuento: { tipo: 'MONTO', valor: 4, motivo: 'Producto golpeado' } } });
        assert.equal(venta.status, 201, JSON.stringify(venta.body));
        const [v] = await bd.sql(`SELECT descuento_manual::float8 AS d, motivo_descuento AS m FROM venta_caja WHERE id_venta = $1`, [venta.body.id_venta]);
        assert.deepEqual(v, { d: 4, m: 'Producto golpeado' });

        assert.equal((await api('PUT', '/ajustes/parametros', { token: tAdmin, body: { descuento_max_cajero: 20 } })).status, 200);
        const r = await cotizar(tCajero, [{ id_producto: id, cantidad: 1 }], { tipo: 'PORCENTAJE', valor: 20, motivo: 'Nuevo tope' });
        assert.equal(r.status, 200);
        await api('PUT', '/ajustes/parametros', { token: tAdmin, body: { descuento_max_cajero: 10 } });
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
            body: { descuento: { tipo: 'PORCENTAJE', valor: 30, motivo: 'Mucho' } } });
        assert.equal(mucho.status, 400);
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
        await bd.sql(`INSERT INTO detalle_cuenta (id_cuenta, id_producto, cantidad, precio_unitario, subtotal, origen, cliente_mesa)
                      VALUES ($1, $2, 3, 6, 18, 'qr', $3)`, [cuenta.id_cuenta, id, cliente]);
        await bd.sql(`UPDATE cuenta_mesa SET total_acumulado = 18 WHERE id_cuenta = $1`, [cuenta.id_cuenta]);

        const e = (await api('GET', `/menu/m/${mesa.codigo_qr}/estado?cliente=${cliente}`)).body;
        assert.equal(e.cuenta.mi_pendiente, 12);
        assert.equal(e.cuenta.mi_descuento, 6);
        assert.equal(e.cuenta.total_mesa, 12);
        assert.equal(e.cuenta.id_cuenta, undefined);
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
