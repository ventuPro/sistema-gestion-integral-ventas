const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');
const { crearPedir } = require('../menuPrueba');

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
        assert.equal(m.detalle, 'HORNADA DE LA MAÑANA', 'el inventario se guarda en mayúsculas');
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

describe('Inventario: ingresos del día', () => {
    test('solo entradas de la sucursal en ese día, sin devoluciones de mesas; el cajero solo la suya', async () => {
        const id = await crearProducto('Ingresos dia', 0);
        await mover(tCajero, { id_producto: id, tipo: 'INGRESO', cantidad: 12, motivo: 'Producción' });
        await mover(tCajero, { id_producto: id, tipo: 'INGRESO', cantidad: 6,  motivo: 'Producción' });
        await mover(tCajero, { id_producto: id, tipo: 'SALIDA',  cantidad: 1,  motivo: 'Degustación' });
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 43, md5(random()::text)) RETURNING id_mesa`);
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        const ag = await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tCajero, body: { id_producto: id, cantidad: 2 } });
        await api('DELETE', `/cuentas/detalle/${ag.body.detalle.id_detalle_cuenta}`, { token: tCajero });

        const deHoy = (await api('GET', '/inventario/ingresos', { token: tCajero })).body.filter(m => m.id_producto === id);
        assert.deepEqual(deHoy.map(m => m.cantidad_movida), [6, 12]);   // el más reciente primero
        assert.ok(deHoy[0].nombre_categoria && deHoy[0].usuario);

        const [{ hoy }] = await bd.sql(`SELECT to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') AS hoy`);
        assert.equal((await api('GET', `/inventario/ingresos?fecha=${hoy}`, { token: tAdmin })).body.filter(m => m.id_producto === id).length, 2);
        assert.equal((await api('GET', '/inventario/ingresos?fecha=2020-01-01', { token: tAdmin })).body.length, 0);
        assert.equal((await api('GET', `/inventario/ingresos?id_sucursal=${idOtraSucursal}`, { token: tAdmin })).body.some(m => m.id_producto === id), false);
        assert.equal((await api('GET', `/inventario/ingresos?id_sucursal=${idOtraSucursal}`, { token: tCajero })).status, 403);
        assert.equal((await api('GET', '/inventario/ingresos?fecha=28/10/2026', { token: tAdmin })).status, 400);
        assert.equal((await api('GET', '/inventario/ingresos', { token: tCajeroSinPermiso })).status, 403);
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
        const ped = await crearPedir(api)(mesa.codigo_qr, [{ id_producto: id, cantidad: 2 }]);
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

describe('Menú QR: orden de categorías y ficha del producto', () => {
    test('el admin ordena las categorías; el menú las sigue y las nuevas van al final', async () => {
        const [a] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Orden A') RETURNING id_categoria`);
        const [b] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Orden B') RETURNING id_categoria`);
        const ids = (await api('GET', '/catalogo/categorias', { token: tAdmin })).body.map(c => c.id_categoria);
        const nuevoOrden = [b.id_categoria, a.id_categoria, ...ids.filter(id => id !== a.id_categoria && id !== b.id_categoria)];

        assert.equal((await api('PUT', '/catalogo/categorias/orden', { token: tCajeroSinPermiso, body: { ids: nuevoOrden } })).status, 403);
        assert.equal((await api('PUT', '/catalogo/categorias/orden', { token: tAdmin, body: { ids: [1, 1] } })).status, 400);
        const r = await api('PUT', '/catalogo/categorias/orden', { token: tAdmin, body: { ids: nuevoOrden } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.map(c => c.id_categoria), nuevoOrden);

        const nueva = await api('POST', '/catalogo/categorias', { token: tAdmin, body: { nombre_categoria: 'Orden C' } });
        const lista = (await api('GET', '/catalogo/categorias', { token: tAdmin })).body;
        assert.equal(lista.at(-1).id_categoria, nueva.body.categoria.id_categoria);

        await bd.sql(`INSERT INTO producto (id_categoria, nombre_producto, precio_unitario) VALUES ($1, 'Prod A', 1), ($2, 'Prod B', 1)`,
                     [a.id_categoria, b.id_categoria]);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual)
                      SELECT 1, id_producto, 5 FROM producto WHERE nombre_producto IN ('Prod A', 'Prod B')`);
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 91, md5(random()::text)) RETURNING codigo_qr`);
        const menu = (await api('GET', `/menu/m/${mesa.codigo_qr}/catalogo`)).body.map(p => p.nombre_producto);
        assert.ok(menu.indexOf('Prod B') < menu.indexOf('Prod A'));
    });

    test('nombre, descripción y categoría se guardan en mayúsculas; la categoría solo admite letras', async () => {
        const id = await crearProducto('Torta mayus', 1);
        const r = await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: {
            nombre_producto: 'Fanta 500 ml', descripcion_producto: 'Bien fría', precio_unitario: 7 } });
        assert.equal(r.status, 200);
        assert.equal(r.body.producto.nombre_producto, 'FANTA 500 ML');
        assert.equal(r.body.producto.descripcion_producto, 'BIEN FRÍA');
        const c = await api('POST', '/catalogo/categorias', { token: tAdmin, body: { nombre_categoria: ' Tés y cafés ' } });
        assert.equal(c.status, 201, JSON.stringify(c.body));
        assert.equal(c.body.categoria.nombre_categoria, 'TÉS Y CAFÉS');
        assert.equal((await api('POST', '/catalogo/categorias', { token: tAdmin, body: { nombre_categoria: 'Bebidas 2' } })).status, 400);
    });

    test('ingredientes, preparación, recomendado y visibilidad en el menú se guardan y llegan al cliente', async () => {
        const id = await crearProducto('Torta ficha', 4);
        const r = await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: {
            nombre_producto: 'Torta ficha', precio_unitario: 10,
            ingredientes: '  Harina, huevo, chocolate  ', preparacion: 'Horneamos\nRellenamos', destacado: true } });
        assert.equal(r.status, 200);
        assert.equal(r.body.producto.ingredientes, 'HARINA, HUEVO, CHOCOLATE');
        assert.equal(r.body.producto.destacado, true);
        assert.ok(r.body.producto.id_categoria, 'lo que no se envía no se borra');

        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                     VALUES (1, 92, md5(random()::text)) RETURNING codigo_qr`);
        const enMenu = async () => (await api('GET', `/menu/m/${mesa.codigo_qr}/catalogo`)).body.find(p => p.id_producto === id);
        const p = await enMenu();
        assert.deepEqual([p.ingredientes, p.preparacion, p.destacado], ['HARINA, HUEVO, CHOCOLATE', 'HORNEAMOS\nRELLENAMOS', true]);

        await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { ingredientes: '', mostrar_en_menu: false } });
        assert.equal(await enMenu(), undefined);
        assert.equal((await bd.sql(`SELECT ingredientes FROM producto WHERE id_producto = $1`, [id]))[0].ingredientes, null);
    });
});

// ─── Transferencias entre sucursales ───
describe('Transferencias entre sucursales', () => {
    const transferir = (token, body) => api('POST', '/inventario/transferencias', { token, body });
    const historialDe = async (id_producto, id_sucursal) =>
        (await api('GET', `/inventario/movimientos?id_producto=${id_producto}&id_sucursal=${id_sucursal}`, { token: tAdmin })).body
            .map(m => `${m.tipo_movimiento} ${m.cantidad_movida} ${m.motivo_movimiento} | ${m.detalle} | saldo ${m.stock_resultante}`);

    test('sale del origen y entra al destino a la vez, con historial en ambas sucursales', async () => {
        const torta = await crearProducto('Torta transferida', 50);
        const pie   = await crearProducto('Pie transferido', 10);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 4)`,
                     [idOtraSucursal, torta]);
        const [{ nombre_sucursal: central }] = await bd.sql(`SELECT nombre_sucursal FROM sucursal WHERE id_sucursal = 1`);

        const r = await transferir(tCajero, { id_sucursal_destino: idOtraSucursal, observacion: 'Para el sábado',
            items: [{ id_producto: torta, cantidad: 15 }, { id_producto: pie, cantidad: 3 }, { id_producto: torta, cantidad: 5 }] });
        assert.equal(r.status, 201);
        const id = r.body.id_transferencia;

        assert.equal(await stock(torta), 30);
        assert.equal(await stock(torta, idOtraSucursal), 24);
        assert.equal(await stock(pie), 7);
        // El destino no tenía el pie: se le crea en su inventario
        assert.equal(await stock(pie, idOtraSucursal), 3);

        assert.equal((await historialDe(torta, 1))[0], `SALIDA 20 Transferencia | A Otra sucursal · #${id} | saldo 30`);
        assert.equal((await historialDe(torta, idOtraSucursal))[0], `INGRESO 20 Transferencia | Desde ${central} · #${id} | saldo 24`);

        const det = await api('GET', `/inventario/transferencias/${id}`, { token: tCajero });
        assert.equal(det.status, 200);
        assert.equal(det.body.observacion, 'PARA EL SÁBADO');
        assert.equal(det.body.usuario, 'cajero.inv@prueba.com');
        assert.deepEqual(det.body.items.map(i => [i.nombre_producto, i.cantidad]),
                         [['Pie transferido', 3], ['Torta transferida', 20]]);

        const lista = (await api('GET', '/inventario/transferencias', { token: tCajero })).body;
        const fila = lista.find(t => t.id_transferencia === id);
        assert.equal(fila.productos, 2);
        assert.equal(fila.unidades, 23);
    });

    test('no se transfiere más de lo que hay; si un producto falla, no se mueve nada', async () => {
        const a = await crearProducto('Transf A', 10), b = await crearProducto('Transf B', 2);
        const r = await transferir(tAdmin, { id_sucursal_origen: 1, id_sucursal_destino: idOtraSucursal,
            items: [{ id_producto: a, cantidad: 5 }, { id_producto: b, cantidad: 3 }] });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /Solo quedan 2 de "Transf B"/);
        assert.equal(await stock(a), 10);
        assert.equal((await bd.sql(`SELECT 1 FROM inventario_sucursal WHERE id_sucursal = $1 AND id_producto = $2`,
                                   [idOtraSucursal, a])).length, 0);
    });

    test('validaciones: misma sucursal, destino inactivo, cantidades y producto inexistente', async () => {
        const p = await crearProducto('Transf validar', 10);
        const item = [{ id_producto: p, cantidad: 1 }];
        const destino = idOtraSucursal;
        assert.equal((await transferir(tCajero, { id_sucursal_destino: 1, items: item })).status, 400);
        assert.equal((await transferir(tCajero, { id_sucursal_destino: destino, items: [] })).status, 400);
        assert.equal((await transferir(tCajero, { id_sucursal_destino: destino, items: [{ id_producto: p, cantidad: 0 }] })).status, 400);
        assert.equal((await transferir(tCajero, { id_sucursal_destino: destino, items: [{ id_producto: p, cantidad: 1.5 }] })).status, 400);
        assert.equal((await transferir(tCajero, { id_sucursal_destino: destino, items: [{ id_producto: 999999, cantidad: 1 }] })).status, 400);
        assert.equal((await transferir(tCajero, { id_sucursal_destino: 999999, items: item })).status, 404);

        const [inactiva] = await bd.sql(
            `INSERT INTO sucursal (nombre_sucursal, estado_activo) VALUES ('Cerrada', FALSE) RETURNING id_sucursal`);
        const r = await transferir(tCajero, { id_sucursal_destino: inactiva.id_sucursal, items: item });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /inactiva/);
        assert.equal(await stock(p), 10);
    });

    test('el cajero solo transfiere desde su sucursal y solo ve las suyas; sin permiso de inventario no entra', async () => {
        const p = await crearProducto('Transf permisos', 10, idOtraSucursal);
        const ajena = await transferir(tCajero, { id_sucursal_origen: idOtraSucursal, id_sucursal_destino: 1,
                                                  items: [{ id_producto: p, cantidad: 1 }] });
        assert.equal(ajena.status, 403);

        const admin = await transferir(tAdmin, { id_sucursal_origen: idOtraSucursal, id_sucursal_destino: 1,
                                                 items: [{ id_producto: p, cantidad: 4 }] });
        assert.equal(admin.status, 201);
        assert.equal(await stock(p, idOtraSucursal), 6);
        assert.equal(await stock(p, 1), 4);

        // Llegó a la sucursal del cajero: la ve
        assert.equal((await api('GET', `/inventario/transferencias/${admin.body.id_transferencia}`, { token: tCajero })).status, 200);

        const [s3] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Tercera') RETURNING id_sucursal`);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 5)`,
                     [s3.id_sucursal, p]);
        const otra = await transferir(tAdmin, { id_sucursal_origen: s3.id_sucursal, id_sucursal_destino: idOtraSucursal,
                                                items: [{ id_producto: p, cantidad: 1 }] });
        const idOtra = otra.body.id_transferencia;
        assert.equal((await api('GET', `/inventario/transferencias/${idOtra}`, { token: tCajero })).status, 404);
        assert.ok(!(await api('GET', '/inventario/transferencias', { token: tCajero })).body.some(t => t.id_transferencia === idOtra));
        assert.ok((await api('GET', '/inventario/transferencias', { token: tAdmin })).body.some(t => t.id_transferencia === idOtra));

        assert.equal((await api('GET', '/inventario/transferencias', { token: tCajeroSinPermiso })).status, 403);
        assert.equal((await transferir(tCajeroSinPermiso, { id_sucursal_destino: idOtraSucursal, items: [] })).status, 403);
    });

    test('dos transferencias simultáneas de las últimas unidades: solo una sale', async () => {
        const p = await crearProducto('Transf carrera', 5);
        const [r1, r2] = await Promise.all([
            transferir(tAdmin, { id_sucursal_origen: 1, id_sucursal_destino: idOtraSucursal,
                                 items: [{ id_producto: p, cantidad: 4 }] }),
            transferir(tCajero, { id_sucursal_destino: idOtraSucursal, items: [{ id_producto: p, cantidad: 4 }] })
        ]);
        assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
        assert.equal(await stock(p), 1);
        assert.equal(await stock(p, idOtraSucursal), 4);
    });
});
