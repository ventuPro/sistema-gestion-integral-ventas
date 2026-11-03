const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Costos de producción: insumos, recetas e inversión guardada ───

let bd, servidor, io, pool, URL_BASE, tAdmin, tCajero, U;

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
const insumo = async (nombre, cantidad_compra, unidad, precio_compra) => {
    const r = await api('POST', '/costos/insumos', { token: tAdmin, body: { nombre, cantidad_compra, id_unidad_compra: U[unidad], precio_compra } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id_insumo;
};
const cerca = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, `${a} ≠ ${b}`);

before(async () => {
    bd = await crearBdPrueba();
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    await bd.sql(`INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
                  VALUES (1, 2, 'CAJERO COSTOS', 'cajero.costos@prueba.com', $1)`, [await bcrypt.hash('Prueba123', 4)]);
    tCajero = await iniciarSesion('cajero.costos@prueba.com', 'Prueba123');
    U = Object.fromEntries((await api('GET', '/costos/unidades', { token: tAdmin })).body.map(u => [u.codigo, u.id_unidad]));
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Costos de producción', () => {
    let harina, mantequilla, huevo, leche, id_receta;

    test('solo el administrador entra', async () => {
        assert.equal((await api('GET', '/costos/insumos', { token: tCajero })).status, 403);
        assert.equal((await api('GET', '/costos/insumos')).status, 401);
    });

    test('unidades: quintal 46 kg, arroba 11,5 kg y libra 460 g', async () => {
        const u = (await api('GET', '/costos/unidades', { token: tAdmin })).body;
        const f = Object.fromEntries(u.map(x => [x.codigo, x.factor_base]));
        assert.equal(f.quintal, 46000);
        assert.equal(f.arroba, 11500);
        assert.equal(f.lb, 460);
        assert.equal(f.mg, 0.001);
        assert.equal(f.l, 1000);
        assert.equal(f.maple, 30);
    });

    test('un quintal de harina a Bs 280 cuesta 280 ÷ 46 000 por gramo', async () => {
        harina      = await insumo('harina', 1, 'quintal', 280);
        mantequilla = await insumo('Mantequilla', 1, 'kg', 60);
        huevo       = await insumo('Huevo', 1, 'maple', 30);
        leche       = await insumo('Leche', 1, 'l', 8);
        const lista = (await api('GET', '/costos/insumos', { token: tAdmin })).body;
        const h = lista.find(i => i.id_insumo === harina);
        assert.equal(h.nombre, 'HARINA');
        cerca(h.costo_base, 280 / 46000);
        assert.equal((await api('POST', '/costos/insumos', { token: tAdmin,
            body: { nombre: 'HARINA', cantidad_compra: 1, id_unidad_compra: U.kg, precio_compra: 1 } })).status, 409);
    });

    test('la receta suma cada insumo en su unidad y guarda la inversión', async () => {
        const r = await api('POST', '/costos/recetas', { token: tAdmin, body: { nombre: 'Croissant', rendimiento: 30, ingredientes: [
            { id_insumo: harina, cantidad: 1.5, id_unidad: U.kg },
            { id_insumo: mantequilla, cantidad: 500, id_unidad: U.g },
            { id_insumo: huevo, cantidad: 4, id_unidad: U.u },
            { id_insumo: leche, cantidad: 400, id_unidad: U.ml }
        ] } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        id_receta = r.body.id_receta;

        const esperado = 1500 * 280 / 46000 + 500 * 60 / 1000 + 4 * 30 / 30 + 400 * 8 / 1000;   // 46,3304
        const receta = (await api('GET', `/costos/recetas/${id_receta}`, { token: tAdmin })).body;
        cerca(receta.inversion, Math.round(esperado * 10000) / 10000);
        cerca(receta.por_unidad, Math.round(esperado / 30 * 10000) / 10000);
        cerca(receta.ingredientes.find(x => x.id_insumo === harina).costo, 9.1304);
        const [{ inversion }] = await bd.sql(`SELECT inversion::float8 FROM receta WHERE id_receta = $1`, [id_receta]);
        cerca(inversion, 46.3304);
    });

    test('no deja medir un insumo en una unidad de otro tipo', async () => {
        const r = await api('POST', '/costos/recetas', { token: tAdmin, body: { nombre: 'Mala', rendimiento: 1,
            ingredientes: [{ id_insumo: harina, cantidad: 100, id_unidad: U.ml }] } });
        assert.equal(r.status, 400);
        assert.match(r.body.error, /HARINA no se mide en ml/);
    });

    test('al subir el precio de un insumo, la receta se recalcula sola y queda en su historial', async () => {
        const r = await api('PUT', `/costos/insumos/${harina}`, { token: tAdmin, body: { precio_compra: 300 } });
        assert.equal(r.status, 200);
        assert.equal(r.body.recetas_actualizadas, 1);
        const receta = (await api('GET', `/costos/recetas/${id_receta}`, { token: tAdmin })).body;
        cerca(receta.inversion, Math.round((1500 * 300 / 46000 + 37.2) * 10000) / 10000);   // 46,9826

        const hist = (await api('GET', `/costos/recetas/${id_receta}/historial`, { token: tAdmin })).body;
        assert.equal(hist.length, 2);
        assert.match(hist[0].motivo, /HARINA: Bs 280\.00 \(1 quintal\) → Bs 300\.00 \(1 quintal\)/);
        assert.equal(hist[1].motivo, 'Receta creada');
        assert.equal((await api('GET', `/costos/insumos/${harina}/historial`, { token: tAdmin })).body.length, 2);

        // Cambiar solo el nombre no recalcula ni deja historial
        await api('PUT', `/costos/insumos/${harina}`, { token: tAdmin, body: { nombre: 'Harina 0000' } });
        assert.equal((await api('GET', `/costos/recetas/${id_receta}/historial`, { token: tAdmin })).body.length, 2);
    });

    test('editar la receta (rendimiento) queda en el historial con el nuevo costo por unidad', async () => {
        const receta = (await api('GET', `/costos/recetas/${id_receta}`, { token: tAdmin })).body;
        const r = await api('PUT', `/costos/recetas/${id_receta}`, { token: tAdmin, body: {
            nombre: receta.nombre, rendimiento: 20,
            ingredientes: receta.ingredientes.map(x => ({ id_insumo: x.id_insumo, cantidad: x.cantidad, id_unidad: x.id_unidad })) } });
        assert.equal(r.status, 200);
        const [ultimo] = (await api('GET', `/costos/recetas/${id_receta}/historial`, { token: tAdmin })).body;
        assert.equal(ultimo.motivo, 'Receta editada');
        cerca(ultimo.por_unidad, Math.round(46.9826 / 20 * 10000) / 10000);
    });

    test('un insumo usado no se elimina; la receta sí', async () => {
        const r = await api('DELETE', `/costos/insumos/${harina}`, { token: tAdmin });
        assert.equal(r.status, 409);
        assert.match(r.body.error, /CROISSANT/);
        assert.equal((await api('DELETE', `/costos/recetas/${id_receta}`, { token: tAdmin })).status, 200);
        assert.equal((await api('DELETE', `/costos/insumos/${harina}`, { token: tAdmin })).status, 200);
    });
});
