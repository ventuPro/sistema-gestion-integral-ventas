const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Movimientos de inventario: entradas y mermas con motivo ───
// Levantan el backend real contra una BD temporal.

process.env.MENU_MAX_PEDIDOS_IP = '1000';

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

const crearProducto = async (nombre, cantidad, id_sucursal = 1) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, 10) RETURNING id_producto`, [nombre]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, $3)`,
                 [id_sucursal, p.id_producto, cantidad]);
    return p.id_producto;
};

const stock = async (id_producto, id_sucursal = 1) => Number((await bd.sql(
    `SELECT cantidad_actual FROM inventario_sucursal WHERE id_sucursal = $1 AND id_producto = $2`,
    [id_sucursal, id_producto]))[0].cantidad_actual);

const mover = (token, body) => api('POST', '/inventario/movimientos', { token, body });

let tAdmin, tCajero, tCajeroSinPermiso, idCajero, idOtraSucursal;

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idOtraSucursal }] = await bd.sql(
        `INSERT INTO sucursal (nombre_sucursal) VALUES ('Otra sucursal') RETURNING id_sucursal`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    idCajero = await crearUsuario('cajero.inv@prueba.com', 2);
    await crearUsuario('cajero.sin@prueba.com', 2);
    const permisos = await api('PUT', `/permisos/usuario/${idCajero}`,
        { token: tAdmin, body: { permisos: { inventario: true, punto_venta: true, mesas: true } } });
    assert.equal(permisos.status, 200);
    tCajero           = await iniciarSesion('cajero.inv@prueba.com', CLAVE);
    tCajeroSinPermiso = await iniciarSesion('cajero.sin@prueba.com', CLAVE);
    // Mesas y menú QR exigen un turno de caja abierto en la sucursal
    const turno = await api('POST', '/caja/turnos/abrir', { token: tCajero, body: { id_sucursal: 1, monto_inicial: 100 } });
    assert.equal(turno.status, 201);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Inventario: acceso', () => {
    test('sin sesión 401; sin permiso de inventario 403', async () => {
        const id = await crearProducto('Acceso', 5);
        const body = { id_producto: id, tipo: 'INGRESO', cantidad: 1, motivo: 'Producción' };
        assert.equal((await mover(null, body)).status, 401);
        assert.equal((await mover(tCajeroSinPermiso, body)).status, 403);
        assert.equal((await api('GET', '/inventario/movimientos', { token: tCajeroSinPermiso })).status, 403);
    });

    test('lista de motivos por tipo', async () => {
        const r = await api('GET', '/inventario/motivos', { token: tAdmin });
        assert.equal(r.status, 200);
        assert.ok(r.body.INGRESO.includes('Producción'));
        assert.ok(r.body.SALIDA.includes('Vencido'));
    });

    test('la ruta vieja que sumaba stock sin registro ya no existe', async () => {
        const id = await crearProducto('Ruta vieja', 5);
        const r = await api('PATCH', `/catalogo/productos/${id}/stock`, { token: tAdmin, body: { cantidad: 10, id_sucursal: 1 } });
        assert.equal(r.status, 404);
        assert.equal(await stock(id), 5);
    });
});

describe('Inventario: entradas y mermas', () => {
    test('una entrada suma al stock y queda en el historial con usuario y saldo', async () => {
        const id = await crearProducto('Torta entrada', 3);
        const r = await mover(tAdmin, { id_producto: id, id_sucursal: 1, tipo: 'INGRESO', cantidad: 12, motivo: 'Producción', detalle: ' Hornada de la mañana ' });
        assert.equal(r.status, 201);
        assert.equal(r.body.stock_actual, 15);
        assert.equal(await stock(id), 15);

        const lista = await api('GET', `/inventario/movimientos?id_sucursal=1&id_producto=${id}`, { token: tAdmin });
        assert.equal(lista.status, 200);
        assert.equal(lista.body.length, 1);
        const m = lista.body[0];
        assert.equal(m.tipo_movimiento, 'INGRESO');
        assert.equal(m.cantidad_movida, 12);
        assert.equal(m.motivo_movimiento, 'Producción');
        assert.equal(m.detalle, 'Hornada de la mañana');
        assert.equal(m.stock_resultante, 15);
        assert.ok(m.usuario);
    });

    test('una merma resta; no se puede dar de baja más de lo que hay', async () => {
        const id = await crearProducto('Pie merma', 4);
        let r = await mover(tAdmin, { id_producto: id, tipo: 'SALIDA', cantidad: 5, motivo: 'Vencido' });
        assert.equal(r.status, 409);
        assert.equal(r.body.codigo, 'SIN_STOCK');
        assert.equal(await stock(id), 4);

        r = await mover(tAdmin, { id_producto: id, tipo: 'SALIDA', cantidad: 4, motivo: 'Dañado' });
        assert.equal(r.status, 201);
        assert.equal(await stock(id), 0);
    });

    test('datos inválidos se rechazan sin tocar el stock', async () => {
        const id = await crearProducto('Validaciones', 10);
        const casos = [
            { id_producto: id, tipo: 'INGRESO', cantidad: 0,   motivo: 'Producción' },
            { id_producto: id, tipo: 'INGRESO', cantidad: 2.5, motivo: 'Producción' },
            { id_producto: id, tipo: 'INGRESO', cantidad: -3,  motivo: 'Producción' },
            { id_producto: id, tipo: 'AJUSTE',  cantidad: 1,   motivo: 'Producción' },
            { id_producto: id, tipo: 'INGRESO', cantidad: 1,   motivo: 'Vencido' },
            { id_producto: id, tipo: 'SALIDA',  cantidad: 1,   motivo: 'Otro' },
            { id_producto: id, tipo: 'SALIDA',  cantidad: 1,   motivo: 'Otro', detalle: 'x'.repeat(201) },
            { tipo: 'INGRESO', cantidad: 1, motivo: 'Producción' }
        ];
        for (const body of casos) assert.equal((await mover(tAdmin, body)).status, 400, JSON.stringify(body).slice(0, 80));
        assert.equal(await stock(id), 10);
        assert.equal((await mover(tAdmin, { id_producto: 999999, tipo: 'INGRESO', cantidad: 1, motivo: 'Producción' })).status, 404);
    });
});

describe('Inventario: sucursales', () => {
    test('el cajero mueve y consulta solo su sucursal; el admin elige', async () => {
        const propio = await crearProducto('Propio cajero', 2);
        const ajeno  = await crearProducto('Ajeno cajero', 2, idOtraSucursal);

        let r = await mover(tCajero, { id_producto: propio, tipo: 'INGRESO', cantidad: 3, motivo: 'Compra a proveedor' });
        assert.equal(r.status, 201);
        assert.equal(await stock(propio), 5);

        r = await mover(tCajero, { id_producto: ajeno, id_sucursal: idOtraSucursal, tipo: 'INGRESO', cantidad: 3, motivo: 'Producción' });
        assert.equal(r.status, 403);
        assert.equal(await stock(ajeno, idOtraSucursal), 2);
        assert.equal((await api('GET', `/inventario/movimientos?id_sucursal=${idOtraSucursal}`, { token: tCajero })).status, 403);

        r = await mover(tAdmin, { id_producto: ajeno, id_sucursal: idOtraSucursal, tipo: 'INGRESO', cantidad: 3, motivo: 'Producción' });
        assert.equal(r.status, 201);
        assert.equal(await stock(ajeno, idOtraSucursal), 5);
    });
});

describe('Inventario: historial', () => {
    test('filtros por tipo y fecha; formato de fecha inválido 400', async () => {
        const id = await crearProducto('Filtros', 10);
        await mover(tAdmin, { id_producto: id, tipo: 'INGRESO', cantidad: 2, motivo: 'Producción' });
        await mover(tAdmin, { id_producto: id, tipo: 'SALIDA',  cantidad: 1, motivo: 'Degustación' });

        const salidas = await api('GET', `/inventario/movimientos?id_producto=${id}&tipo=SALIDA`, { token: tAdmin });
        assert.deepEqual(salidas.body.map(m => m.motivo_movimiento), ['Degustación']);

        const [{ hoy }] = await bd.sql(`SELECT to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') AS hoy`);
        const deHoy = await api('GET', `/inventario/movimientos?id_producto=${id}&desde=${hoy}&hasta=${hoy}`, { token: tAdmin });
        assert.equal(deHoy.body.length, 2);
        assert.equal(deHoy.body[0].motivo_movimiento, 'Degustación');   // el más reciente primero
        assert.equal(deHoy.body[0].stock_resultante, 11);

        const futuro = await api('GET', `/inventario/movimientos?id_producto=${id}&desde=2999-01-01`, { token: tAdmin });
        assert.equal(futuro.body.length, 0);
        assert.equal((await api('GET', '/inventario/movimientos?desde=14/10/2026', { token: tAdmin })).status, 400);
    });

    test('el stock inicial de un producto nuevo queda registrado', async () => {
        const [{ id_categoria }] = await bd.sql(`SELECT min(id_categoria) AS id_categoria FROM categoria_producto`);
        const r = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
            nombre_producto: 'Nuevo con stock', precio_unitario: 15, id_categoria, id_sucursal: 1, stock_inicial: 8
        } });
        assert.equal(r.status, 201);
        const lista = await api('GET', `/inventario/movimientos?id_producto=${r.body.producto.id_producto}`, { token: tAdmin });
        assert.equal(lista.body.length, 1);
        assert.equal(lista.body[0].motivo_movimiento, 'Stock inicial');
        assert.equal(lista.body[0].stock_resultante, 8);
    });
});

describe('Inventario: mesas y menú QR también quedan en el historial', () => {
    const historial = async (id) =>
        (await api('GET', `/inventario/movimientos?id_producto=${id}`, { token: tAdmin })).body
            .map(m => `${m.tipo_movimiento} ${m.cantidad_movida} ${m.motivo_movimiento} | ${m.detalle} | saldo ${m.stock_resultante}`);

    test('agregar y quitar en una cuenta de mesa', async () => {
        const id = await crearProducto('Torta mesa', 10);
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 41, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } });
        assert.equal(cuenta.status, 201);
        const id_cuenta = cuenta.body.cuenta.id_cuenta;

        const ag = await api('POST', `/cuentas/${id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 3 } });
        assert.equal(ag.status, 201);
        const quitar = await api('DELETE', `/cuentas/detalle/${ag.body.detalle.id_detalle_cuenta}`, { token: tCajero });
        assert.equal(quitar.status, 200);

        assert.deepEqual(await historial(id), [
            'INGRESO 3 Devuelto de cuenta de mesa | Mesa 41 | saldo 10',
            'SALIDA 3 Cuenta de mesa | Mesa 41 | saldo 7'
        ]);
    });

    test('un pedido QR reserva stock y al rechazarlo vuelve', async () => {
        const id = await crearProducto('Pie QR', 6);
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 42, md5(random()::text)) RETURNING codigo_qr`);
        const ped = await api('POST', `/menu/m/${mesa.codigo_qr}/pedidos`, { body: { items: [{ id_producto: id, cantidad: 2 }] } });
        assert.equal(ped.status, 201);
        assert.equal((await api('POST', `/pedidos/${ped.body.id_pedido}/rechazar`, { token: tCajero })).status, 200);

        assert.deepEqual(await historial(id), [
            `INGRESO 2 Pedido QR devuelto | Pedido #${ped.body.id_pedido} cancelado | saldo 6`,
            'SALIDA 2 Pedido QR | Mesa 42 | saldo 4'
        ]);
    });
});

// ─── Fotos de productos: solo imágenes reales, la reemplazada se borra ───
describe('Fotos de productos', () => {
    const fs = require('fs');
    const path = require('path');
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const archivo = (url) => path.join(process.env.UPLOADS_DIR, url.slice('/uploads/'.length));

    test('rechaza SVG, archivos disfrazados y rutas externas; al cambiar la foto borra la anterior', async () => {
        const [{ id_categoria }] = await bd.sql(`SELECT min(id_categoria) AS id_categoria FROM categoria_producto`);
        const base = { nombre_producto: 'Con foto', precio_unitario: 10, id_categoria, id_sucursal: 1 };
        const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64');
        const falso = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
        for (const url_imagen of [svg, falso])
            assert.equal((await api('POST', '/catalogo/productos', { token: tAdmin, body: { ...base, url_imagen } })).status, 400);

        const externo = await api('POST', '/catalogo/productos', { token: tAdmin, body: { ...base, url_imagen: 'https://otro.com/x.png' } });
        assert.equal(externo.body.producto.url_imagen, null);

        const r = await api('POST', '/catalogo/productos', { token: tAdmin, body: { ...base, url_imagen: PNG } });
        const id = r.body.producto.id_producto, primera = r.body.producto.url_imagen;
        assert.match(primera, /^\/uploads\/productos\/prod_\d+_[0-9a-f]+\.png$/);
        assert.ok(fs.existsSync(archivo(primera)));

        const sinCambio = await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { ...base, precio_unitario: 11 } });
        assert.equal(sinCambio.body.producto.url_imagen, primera);

        const nueva = (await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { ...base, url_imagen: PNG } })).body.producto.url_imagen;
        assert.notEqual(nueva, primera);
        await new Promise(ok => setTimeout(ok, 100));
        assert.ok(!fs.existsSync(archivo(primera)), 'la foto reemplazada se borra');
        assert.ok(fs.existsSync(archivo(nueva)));

        const img = await fetch(`${URL_BASE}${nueva}`);
        assert.equal(img.status, 200);
        assert.match(img.headers.get('cache-control'), /max-age=31536000.*immutable/);
        assert.equal((await api('PUT', '/catalogo/productos/999999', { token: tAdmin, body: base })).status, 404);
    });

    test('al arrancar se borran las fotos que nadie usa', async () => {
        const { limpiarHuerfanas } = require('../../src/utils/imagenes');
        const dir = path.join(process.env.UPLOADS_DIR, 'productos');
        const vieja = path.join(dir, 'prod_huerfana.png'), reciente = path.join(dir, 'prod_reciente.png');
        fs.writeFileSync(vieja, 'x'); fs.writeFileSync(reciente, 'x');
        const hace2h = new Date(Date.now() - 2 * 3600 * 1000);
        fs.utimesSync(vieja, hace2h, hace2h);
        const usadas = (await bd.sql(`SELECT url_imagen FROM producto WHERE url_imagen IS NOT NULL`)).map(x => archivo(x.url_imagen));
        for (const u of usadas) fs.utimesSync(u, hace2h, hace2h);

        assert.equal(await limpiarHuerfanas(pool), 1);
        assert.ok(!fs.existsSync(vieja));
        assert.ok(fs.existsSync(reciente), 'las recientes se dejan (pueden estar guardándose)');
        for (const u of usadas) assert.ok(fs.existsSync(u), 'las que usa un producto se quedan');
    });
});
