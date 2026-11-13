const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Reparto de la producción a otras sucursales (Entrada «Producción» + transferencias) ───

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

const crearUsuario = async (correo, id_sucursal = 1) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, 2, $2, $2, $3) RETURNING id_usuario`, [id_sucursal, correo, hash]);
    return u.id_usuario;
};

let tAdmin, tRepartidor, tSinPermiso, s2, s3, idCat;

const crearProducto = async (nombre, tipo = 'ELABORADO') => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario, tipo_producto) VALUES ($1, $2, 5, $3) RETURNING id_producto`,
        [idCat, nombre, tipo]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, 0)`, [p.id_producto]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 0)`, [s2, p.id_producto]);
    return p.id_producto;
};
const stock = async (id_producto, id_sucursal) => Number((await bd.sql(
    `SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`, [id_producto, id_sucursal]))[0]?.cantidad_actual ?? -1);
const producir = (token, id_producto, cantidad, reparto, motivo = 'Producción') => api('POST', '/inventario/movimientos',
    { token, body: { id_producto, id_sucursal: 1, tipo: 'INGRESO', cantidad, motivo, reparto } });

before(async () => {
    bd = await crearBdPrueba();
    [{ id_sucursal: s2 }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('SUCURSAL 2') RETURNING id_sucursal`);
    [{ id_sucursal: s3 }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('SUCURSAL 3') RETURNING id_sucursal`);
    [{ id_categoria: idCat }] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('REPARTO') RETURNING id_categoria`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    const idRep = await crearUsuario('repartidor@prueba.com');
    await crearUsuario('sinreparto@prueba.com');
    const idSin = (await bd.sql(`SELECT id_usuario FROM usuario WHERE correo_electronico = 'sinreparto@prueba.com'`))[0].id_usuario;
    assert.equal((await api('PUT', `/permisos/usuario/${idRep}`, { token: tAdmin, body: { permisos: { inventario: true, reparto: true } } })).status, 200);
    assert.equal((await api('PUT', `/permisos/usuario/${idSin}`, { token: tAdmin, body: { permisos: { inventario: true } } })).status, 200);
    tRepartidor = await iniciarSesion('repartidor@prueba.com', CLAVE);
    tSinPermiso = await iniciarSesion('sinreparto@prueba.com', CLAVE);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Reparto de la producción', () => {
    test('el permiso es aparte y apagado por defecto', async () => {
        const id = await crearProducto('PAN SIN PERMISO');
        const r = await producir(tSinPermiso, id, 10, [{ id_sucursal: s2, cantidad: 5 }]);
        assert.equal(r.status, 403);
        assert.equal(await stock(id, 1), 0);
        // Sin reparto la entrada sigue igual
        assert.equal((await producir(tSinPermiso, id, 10, [])).status, 201);
        assert.equal(await stock(id, 1), 10);
    });

    test('solo con el motivo Producción y sin repartir más de lo producido', async () => {
        const id = await crearProducto('PAN VALIDACION');
        assert.equal((await producir(tRepartidor, id, 10, [{ id_sucursal: s2, cantidad: 5 }], 'Compra a proveedor')).status, 400);
        const mucho = await producir(tRepartidor, id, 10, [{ id_sucursal: s2, cantidad: 6 }, { id_sucursal: s3, cantidad: 5 }]);
        assert.equal(mucho.status, 400);
        assert.match(mucho.body.error, /solo se produjeron 10/);
        assert.equal((await producir(tRepartidor, id, 10, [{ id_sucursal: 1, cantidad: 5 }])).status, 400);
        assert.equal(await stock(id, 1), 0);
    });

    test('entra, se reparte con lo recién producido y queda el resto', async () => {
        const id = await crearProducto('EMPANADA REPARTO');
        // Stock viejo en la sucursal que produce
        assert.equal((await producir(tRepartidor, id, 10, [])).status, 201);
        await bd.sql(`UPDATE lote_inventario l SET fecha_ingreso = LOCALTIMESTAMP - INTERVAL '2 days'
                      FROM inventario_sucursal i WHERE i.id_inventario = l.id_inventario AND i.id_producto = $1`, [id]);

        const r = await producir(tRepartidor, id, 100, [{ id_sucursal: s2, cantidad: 30 }, { id_sucursal: s3, cantidad: 25 }]);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.repartido, 55);
        assert.equal(r.body.stock_actual, 55);
        assert.equal(await stock(id, 1), 55);
        assert.equal(await stock(id, s2), 30);
        assert.equal(await stock(id, s3), 25);   // la sucursal 3 no tenía el producto: se le crea

        // A las sucursales llega lo recién producido, no el lote viejo
        const viejos = await bd.sql(`
            SELECT COUNT(*)::int AS n FROM lote_inventario l JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
            WHERE i.id_producto = $1 AND i.id_sucursal <> 1 AND l.fecha_ingreso < LOCALTIMESTAMP - INTERVAL '1 day'`, [id]);
        assert.equal(viejos[0].n, 0);

        const trs = await bd.sql(`SELECT id_sucursal_destino FROM transferencia t JOIN detalle_transferencia d USING (id_transferencia)
                                  WHERE d.id_producto = $1 AND t.id_historial_produccion IS NOT NULL ORDER BY 1`, [id]);
        assert.deepEqual(trs.map(t => t.id_sucursal_destino), [s2, s3]);
        const avisos = await bd.sql(`SELECT COUNT(*)::int AS n FROM notificacion WHERE tipo = 'TRANSFERENCIA' AND mensaje LIKE '%EMPANADA REPARTO%'`);
        assert.equal(avisos[0].n, 2);

        // Ingresos del día: la producción con su reparto
        const ing = await api('GET', '/inventario/ingresos?id_sucursal=1', { token: tRepartidor });
        const prod = ing.body.find(x => x.id_producto === id && x.cantidad_movida === 100);
        assert.deepEqual(prod.repartido.map(x => [x.id_sucursal, x.cantidad]), [[s2, 30], [s3, 25]]);
    });

    test('todo o nada: si una sucursal está inactiva no se registra nada', async () => {
        const id = await crearProducto('TORTA REPARTO');
        await bd.sql(`UPDATE sucursal SET estado_activo = FALSE WHERE id_sucursal = $1`, [s3]);
        const r = await producir(tAdmin, id, 20, [{ id_sucursal: s2, cantidad: 5 }, { id_sucursal: s3, cantidad: 5 }]);
        await bd.sql(`UPDATE sucursal SET estado_activo = TRUE WHERE id_sucursal = $1`, [s3]);
        assert.equal(r.status, 400);
        assert.equal(await stock(id, 1), 0);
        assert.equal(await stock(id, s2), 0);
    });

    test('lo preparado al momento no se reparte', async () => {
        const id = await crearProducto('CAFE REPARTO', 'PREPARADO');
        assert.equal((await producir(tAdmin, id, 5, [{ id_sucursal: s2, cantidad: 2 }])).status, 400);
    });
});

describe('Nombres de productos parecidos', () => {
    const crear = (nombre, extra = {}) => api('POST', '/catalogo/productos', { token: tAdmin, body: {
        nombre_producto: nombre, precio_unitario: 5, id_categoria: idCat, id_sucursal: 1, tipo_producto: 'ELABORADO', ...extra } });

    test('crear uno casi igual pide confirmar; con confirmación se crea', async () => {
        assert.equal((await crear('EMPANADA DE CHARQUE')).status, 201);
        const r = await crear('EMPANADAS CHARQUE');
        assert.equal(r.status, 409);
        assert.equal(r.body.codigo, 'PARECIDO');
        assert.equal(r.body.parecidos[0].nombre_producto, 'EMPANADA DE CHARQUE');
        assert.equal((await crear('EMPANADA DE POLLO CHARQUE')).status, 201);   // contiene: solo aviso
        assert.equal((await crear('EMPANADAS CHARQUE', { confirmar_parecido: true })).status, 201);
    });

    test('la búsqueda mientras se escribe dice en qué sucursales está', async () => {
        const r = await api('GET', `/catalogo/productos/parecidos?nombre=${encodeURIComponent('empanda charqe')}&id_sucursal=${s2}`, { token: tRepartidor });
        assert.equal(r.status, 200);
        const p = r.body.find(x => x.nombre_producto === 'EMPANADA DE CHARQUE');
        assert.ok(p && ['igual', 'casi'].includes(p.tipo));
        assert.equal(p.en_sucursal, false);
        assert.ok(p.sucursales.length > 0);
    });
});
