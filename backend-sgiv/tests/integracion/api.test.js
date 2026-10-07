const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { crearBdPrueba } = require('../bdPrueba');

// ─── Pruebas de integración de la API ───
// Levantan el backend real (en un puerto libre) contra una BD temporal.

let bd, servidor, io, pool, URL_BASE;
const CLAVE = 'Prueba123';

// Todas las pruebas piden desde 127.0.0.1: se amplía el límite de pedidos por IP del menú
process.env.MENU_MAX_PEDIDOS_IP = '1000';

const api = async (metodo, ruta, { token, body, headers = {} } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    return { status: r.status, body: datos, headers: r.headers };
};

const login = async (correo, contrasena = CLAVE) =>
    (await api('POST', '/usuarios/login', { body: { correo_electronico: correo, contrasena } })).body.token;

const crearUsuario = async (correo, id_rol) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES (1, $1, $2, $2, $3) RETURNING id_usuario`, [id_rol, correo, hash]);
    return u.id_usuario;
};

const crearProducto = async (nombre, precio, cantidad) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, $2) RETURNING id_producto`,
        [nombre, precio]);
    await bd.sql(
        `INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, $2)`,
        [p.id_producto, cantidad]);
    return p.id_producto;
};

const stock = async (id_producto) => {
    const [r] = await bd.sql(
        `SELECT cantidad_actual FROM inventario_sucursal WHERE id_sucursal = 1 AND id_producto = $1`,
        [id_producto]);
    return Number(r.cantidad_actual);
};

const abrirTurno = (token) =>
    api('POST', '/caja/turnos/abrir', { token, body: { id_sucursal: 1, monto_inicial: 100 } });

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);

    // La app se carga después de crear la BD, para que use la BD temporal
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

// ─── Login ───
describe('Login', () => {
    test('el admin del seed inicia sesión y recibe token', async () => {
        const r = await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'admin@rickys.com', contrasena: 'password' } });
        assert.equal(r.status, 200);
        assert.ok(r.body.token);
        assert.equal(r.body.usuario.id_rol, 1);
    });

    test('correo inexistente y contraseña incorrecta dan la misma respuesta', async () => {
        const a = await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'nadie@prueba.com', contrasena: 'x' } });
        const b = await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'admin@rickys.com', contrasena: 'x' } });
        assert.equal(a.status, 401);
        assert.equal(b.status, 401);
        assert.deepEqual(a.body, b.body);
    });

    test('bloquea tras 5 intentos fallidos (429) aunque luego la clave sea correcta', async () => {
        await crearUsuario('bloqueo@prueba.com', 2);
        for (let i = 0; i < 5; i++) {
            const r = await api('POST', '/usuarios/login',
                { body: { correo_electronico: 'bloqueo@prueba.com', contrasena: 'mala' } });
            assert.equal(r.status, 401);
        }
        const r = await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'bloqueo@prueba.com', contrasena: CLAVE } });
        assert.equal(r.status, 429);
    });
});

// ─── Autenticación y permisos ───
describe('Autenticación y permisos', () => {
    test('sin token → 401', async () => {
        assert.equal((await api('GET', '/usuarios')).status, 401);
    });

    test('token firmado con otro secreto (el antiguo) → 401', async () => {
        const falso = jwt.sign({ id_usuario: 1, id_rol: 1, id_sucursal: 1 }, 'ventupro2503_Security_key');
        assert.equal((await api('GET', '/usuarios', { token: falso })).status, 401);
    });

    test('cajero sin permiso de usuarios → 403; admin → 200', async () => {
        await crearUsuario('cajero.permisos@prueba.com', 2);
        const tCajero = await login('cajero.permisos@prueba.com');
        const tAdmin  = await login('admin@rickys.com', 'password');
        assert.equal((await api('GET', '/usuarios', { token: tCajero })).status, 403);
        assert.equal((await api('GET', '/usuarios', { token: tAdmin })).status, 200);
    });

    test('usuario desactivado pierde acceso de inmediato y lo recupera al reactivarlo', async () => {
        const id      = await crearUsuario('cajero.desactivar@prueba.com', 2);
        const tCajero = await login('cajero.desactivar@prueba.com');
        const tAdmin  = await login('admin@rickys.com', 'password');
        assert.equal((await api('GET', '/permisos/mis-permisos', { token: tCajero })).status, 200);

        await api('PATCH', `/usuarios/${id}/desactivar`, { token: tAdmin });
        assert.equal((await api('GET', '/permisos/mis-permisos', { token: tCajero })).status, 401);

        await api('PATCH', `/usuarios/${id}/reactivar`, { token: tAdmin });
        assert.equal((await api('GET', '/permisos/mis-permisos', { token: tCajero })).status, 200);
    });

    test('un cambio de rol aplica sin volver a iniciar sesión', async () => {
        const id = await crearUsuario('admin.degradado@prueba.com', 1);
        const t  = await login('admin.degradado@prueba.com');
        assert.equal((await api('GET', '/usuarios', { token: t })).status, 200);
        await bd.sql(`UPDATE usuario SET id_rol = 2 WHERE id_usuario = $1`, [id]);
        assert.equal((await api('GET', '/usuarios', { token: t })).status, 403);
    });
});

// ─── CORS ───
describe('CORS', () => {
    const origenRespondido = async (ruta, origin) =>
        (await api('GET', ruta, { headers: { Origin: origin } })).headers.get('access-control-allow-origin');

    test('acepta la red local', async () => {
        assert.equal(await origenRespondido('/usuarios', 'http://192.168.1.50:4200'), 'http://192.168.1.50:4200');
    });

    test('no autoriza orígenes ajenos', async () => {
        assert.equal(await origenRespondido('/usuarios', 'https://evil.com'), null);
    });

    test('el menú digital (QR) sigue siendo público', async () => {
        assert.ok(await origenRespondido('/menu/m/codigo-inexistente', 'https://evil.com'));
    });
});

// ─── Punto de venta ───
describe('Punto de venta', () => {
    let tCajero, torta, queque;

    before(async () => {
        await crearUsuario('cajero.pos@prueba.com', 2);
        tCajero = await login('cajero.pos@prueba.com');
        torta   = await crearProducto('Torta POS', 25.50, 20);
        queque  = await crearProducto('Queque POS', 10.00, 20);
    });

    const cobrar = (body) => api('POST', '/caja/cobrar',
        { token: tCajero, body: { id_sucursal: 1, metodo_pago: 'Efectivo', ...body } });

    test('sin turno de caja abierto → CAJA_CERRADA', async () => {
        const r = await cobrar({ monto_total_venta: 25.5, detalles: [{ id_producto: torta, cantidad: 1 }] });
        assert.equal(r.status, 403);
        assert.equal(r.body.error, 'CAJA_CERRADA');
    });

    test('venta normal: guarda el total de la BD y descuenta stock', async () => {
        assert.equal((await abrirTurno(tCajero)).status, 201);

        const r = await cobrar({
            monto_total_venta: 61,
            detalles: [{ id_producto: torta, cantidad: 2 }, { id_producto: queque, cantidad: 1 }]
        });
        assert.equal(r.status, 201);

        const [venta] = await bd.sql(`SELECT monto_total_venta FROM venta_caja WHERE id_venta = $1`, [r.body.id_venta]);
        assert.equal(Number(venta.monto_total_venta), 61);
        assert.equal(await stock(torta), 18);
        assert.equal(await stock(queque), 19);
    });

    test('precio unitario manipulado en el detalle → se guarda el precio real', async () => {
        const r = await cobrar({
            monto_total_venta: 25.5,
            detalles: [{ id_producto: torta, cantidad: 1, precio: 0.01, subtotal: 0.01 }]
        });
        assert.equal(r.status, 201);
        const [d] = await bd.sql(
            `SELECT precio_unitario, subtotal_venta FROM detalle_venta WHERE id_venta = $1`, [r.body.id_venta]);
        assert.equal(Number(d.precio_unitario), 25.5);
        assert.equal(Number(d.subtotal_venta), 25.5);
    });

    test('total distinto al de la BD → PRECIO_DESACTUALIZADO y no se registra nada', async () => {
        const antes = await stock(torta);
        const r = await cobrar({ monto_total_venta: 0.02, detalles: [{ id_producto: torta, cantidad: 2 }] });
        assert.equal(r.status, 409);
        assert.equal(r.body.error, 'PRECIO_DESACTUALIZADO');
        assert.equal(r.body.total, 51);
        assert.equal(await stock(torta), antes);
    });

    test('cantidad negativa → VENTA_INVALIDA y no suma stock', async () => {
        const antes = await stock(torta);
        const r = await cobrar({ monto_total_venta: -25.5, detalles: [{ id_producto: torta, cantidad: -1 }] });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'VENTA_INVALIDA');
        assert.equal(await stock(torta), antes);
    });

    test('stock insuficiente → 409 y la venta completa se revierte', async () => {
        const antesQ = await stock(queque);
        const antesT = await stock(torta);
        const r = await cobrar({
            monto_total_venta: 10 + 25.5 * 100,
            detalles: [{ id_producto: queque, cantidad: 1 }, { id_producto: torta, cantidad: 100 }]
        });
        assert.equal(r.status, 409);
        assert.equal(r.body.error, 'STOCK_INSUFICIENTE');
        assert.equal(await stock(queque), antesQ);
        assert.equal(await stock(torta), antesT);
    });
});

// ─── Mesas y cuentas ───
describe('Mesas y cuentas', () => {
    let tCajero, producto, id_mesa;

    before(async () => {
        await crearUsuario('cajero.mesas@prueba.com', 2);
        tCajero  = await login('cajero.mesas@prueba.com');
        producto = await crearProducto('Café Mesa', 8.00, 10);
        [{ id_mesa }] = await bd.sql(
            `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
             VALUES (1, 99, 'qr-prueba-99') RETURNING id_mesa`);
    });

    test('flujo completo: abrir cuenta, agregar (reserva stock) y cerrar (crea la venta)', async () => {
        const abrir = await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa } });
        assert.equal(abrir.status, 201);
        const id_cuenta = abrir.body.cuenta.id_cuenta;

        const otra = await api('POST', '/cuentas/abrir', { token: tCajero, body: { id_mesa } });
        assert.equal(otra.status, 409);

        const agregar = await api('POST', `/cuentas/${id_cuenta}/producto`,
            { token: tCajero, body: { id_producto: producto, cantidad: 3, precio_unitario: 0.01 } });
        assert.equal(agregar.status, 201);
        assert.equal(await stock(producto), 7);              // stock reservado al agregar
        assert.equal(Number(agregar.body.total), 24);        // precio de la BD, no el enviado

        const sinStock = await api('POST', `/cuentas/${id_cuenta}/producto`,
            { token: tCajero, body: { id_producto: producto, cantidad: 50 } });
        assert.equal(sinStock.status, 409);

        assert.equal((await abrirTurno(tCajero)).status, 201);
        const cerrar = await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'Efectivo', id_sucursal: 1 } });
        assert.equal(cerrar.status, 200);

        const [venta] = await bd.sql(
            `SELECT monto_total_venta FROM venta_caja WHERE id_venta = $1`, [cerrar.body.id_venta]);
        assert.equal(Number(venta.monto_total_venta), 24);
        assert.equal(await stock(producto), 7);              // no se descuenta dos veces
        const [mesa] = await bd.sql(`SELECT estado_mesa FROM mesa_local WHERE id_mesa = $1`, [id_mesa]);
        assert.equal(mesa.estado_mesa, 'Libre');
    });
});
