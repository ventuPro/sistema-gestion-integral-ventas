const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Encargos para eventos ───
// No tocan caja ni stock; el cajero solo ve y gestiona los de su sucursal.

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

let tAdmin, tCajero, tCajeroOtra, idOtraSucursal, idProducto, hoy, manana, ayer;

const encargo = (extra = {}) => ({
    nombre_cliente: 'Ana Pérez', celular_cliente: '71234567', tipo_evento: 'CUMPLEAÑOS', fecha: manana, hora: '15:30',
    items: [{ id_producto: idProducto, cantidad: 2, precio_unitario: 12 },
            { descripcion: 'Torta de tres pisos', detalle: 'Chocolate con frutilla', cantidad: 1, precio_unitario: 300 }],
    adelanto: 100, ...extra
});
const stock = async () => Number((await bd.sql(
    `SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = 1`, [idProducto]))[0].cantidad_actual);

before(async () => {
    bd = await crearBdPrueba();
    [{ id_sucursal: idOtraSucursal }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('OTRA') RETURNING id_sucursal`);
    const [cat] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('ENCARGOS') RETURNING id_categoria`);
    [{ id_producto: idProducto }] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario) VALUES ($1, 'SALTEÑA', 10) RETURNING id_producto`, [cat.id_categoria]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, 20)`, [idProducto]);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    ({ rows: [{ hoy, manana, ayer }] } = await pool.query(
        `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS hoy, to_char(CURRENT_DATE + 1, 'YYYY-MM-DD') AS manana,
                to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') AS ayer`));

    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    await crearUsuario('cajero.encargo@prueba.com', 2);
    await crearUsuario('cajero.otra.encargo@prueba.com', 2, idOtraSucursal);
    tCajero     = await iniciarSesion('cajero.encargo@prueba.com', CLAVE);
    tCajeroOtra = await iniciarSesion('cajero.otra.encargo@prueba.com', CLAVE);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Encargos', () => {
    test('el cajero tiene el módulo por defecto', async () => {
        const r = await api('GET', '/permisos/mis-permisos', { token: tCajero });
        assert.equal(r.body.permisos.encargos, true);
        assert.equal((await api('GET', '/encargos', { token: tCajero })).status, 200);
    });

    test('valida celular, adelanto, fecha pasada y dirección', async () => {
        const casos = [
            [{ celular_cliente: '12345' }, /Celular/],
            [{ adelanto: 999 }, /adelanto/],
            [{ fecha: ayer }, /día pasado/],
            [{ a_domicilio: true }, /dirección/],
            [{ items: [] }, /al menos un producto/],
            [{ tipo_evento: 'FIESTA' }, /evento/]
        ];
        for (const [extra, mensaje] of casos) {
            const r = await api('POST', '/encargos', { token: tCajero, body: encargo(extra) });
            assert.equal(r.status, 400, JSON.stringify(extra));
            assert.match(r.body.error, mensaje);
        }
    });

    test('se registra con precio acordado, sin tocar stock ni caja', async () => {
        const antes = await stock();
        const ventas = (await bd.sql(`SELECT COUNT(*)::int AS n FROM venta_caja`))[0].n;
        const r = await api('POST', '/encargos', { token: tCajero, body: encargo({ id_sucursal: idOtraSucursal }) });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const e = r.body.encargo;
        assert.equal(e.id_sucursal, 1);   // el cajero registra en su sucursal aunque pida otra
        assert.equal(e.nombre_cliente, 'ANA PÉREZ');
        assert.equal(e.total, 324);
        assert.equal(e.saldo, 224);
        assert.deepEqual(e.items.map(i => i.descripcion), ['SALTEÑA', 'TORTA DE TRES PISOS']);
        assert.equal(await stock(), antes);
        assert.equal((await bd.sql(`SELECT COUNT(*)::int AS n FROM venta_caja`))[0].n, ventas);
    });

    test('el cajero de otra sucursal no lo ve ni lo toca', async () => {
        const { body: { encargo: e } } = await api('POST', '/encargos', { token: tCajero, body: encargo() });
        const lista = await api('GET', '/encargos', { token: tCajeroOtra });
        assert.ok(!lista.body.some(x => x.id_encargo === e.id_encargo));
        assert.equal((await api('GET', `/encargos/${e.id_encargo}`, { token: tCajeroOtra })).status, 403);
        assert.equal((await api('PATCH', `/encargos/${e.id_encargo}/estado`, { token: tCajeroOtra, body: { entregado: true } })).status, 403);
        assert.equal((await api('DELETE', `/encargos/${e.id_encargo}`, { token: tCajeroOtra })).status, 403);
        const todas = await api('GET', '/encargos', { token: tAdmin });
        assert.ok(todas.body.some(x => x.id_encargo === e.id_encargo));
    });

    test('editar, entregar, deshacer y eliminar', async () => {
        const { body: { encargo: e } } = await api('POST', '/encargos', { token: tCajero, body: encargo() });
        const ed = await api('PUT', `/encargos/${e.id_encargo}`, { token: tCajero, body: encargo({ hora: '18:00', adelanto: 0 }) });
        assert.equal(ed.status, 200);
        assert.equal(ed.body.encargo.hora, '18:00');
        assert.equal(ed.body.encargo.saldo, 324);

        const ent = await api('PATCH', `/encargos/${e.id_encargo}/estado`, { token: tCajero, body: { entregado: true } });
        assert.equal(ent.body.encargo.estado, 'Entregado');
        assert.ok(ent.body.encargo.entregado_por);
        assert.equal((await api('PUT', `/encargos/${e.id_encargo}`, { token: tCajero, body: encargo() })).status, 400);
        assert.equal((await api('DELETE', `/encargos/${e.id_encargo}`, { token: tCajero })).status, 400);

        const des = await api('PATCH', `/encargos/${e.id_encargo}/estado`, { token: tCajero, body: { entregado: false } });
        assert.equal(des.body.encargo.estado, 'Recibido');
        assert.equal((await api('DELETE', `/encargos/${e.id_encargo}`, { token: tCajero })).status, 200);
        assert.equal((await api('GET', `/encargos/${e.id_encargo}`, { token: tAdmin })).status, 404);
    });

    test('los de hoy salen en la ventana del día y en el Panel', async () => {
        const { body: { encargo: e } } = await api('POST', '/encargos', { token: tCajero, body: encargo({ fecha: hoy, hora: '23:59' }) });
        const deHoy = await api('GET', '/encargos/hoy', { token: tCajero });
        assert.ok(deHoy.body.some(x => x.id_encargo === e.id_encargo));
        assert.ok(!(await api('GET', '/encargos/hoy', { token: tCajeroOtra })).body.some(x => x.id_encargo === e.id_encargo));
        const panel = await api('GET', '/reportes/dashboard-completo/1', { token: tAdmin });
        assert.ok(panel.body.encargos.hoy >= 1);
        assert.ok(panel.body.encargos.lista_hoy.some(x => x.id_encargo === e.id_encargo));
    });

    test('aviso anticipado una sola vez por encargo', async () => {
        const { body: { encargo: e } } = await api('POST', '/encargos', { token: tCajero, body: encargo({ nombre_cliente: 'Luis Rojas' }) });
        // Registrado dentro del plazo del aviso: quien lo registra ya sabe, no se avisa
        assert.equal((await bd.sql(`SELECT aviso FROM encargo WHERE id_encargo = $1`, [e.id_encargo]))[0].aviso, 1);
        await bd.sql(`UPDATE encargo SET aviso = 0 WHERE id_encargo = $1`, [e.id_encargo]);
        const temprano = (await bd.sql(`SELECT LOCALTIME < '06:00'::time AS t`))[0].t;
        const encargoModel = require('../../src/models/encargoModel');
        await encargoModel.avisos();
        await encargoModel.avisos();
        const avisos = await bd.sql(`SELECT titulo, mensaje FROM notificacion WHERE tipo = 'ENCARGO' AND mensaje LIKE '%LUIS ROJAS%'`);
        assert.equal(avisos.length, temprano ? 0 : 1);
        if (!temprano) assert.match(avisos[0].titulo, /Próximos/);
    });
});
