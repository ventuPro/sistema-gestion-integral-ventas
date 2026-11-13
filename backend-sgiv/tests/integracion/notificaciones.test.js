const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Notificaciones: stock bajo/agotado, arqueo, caja sin cerrar, transferencias y descuentos ───

let bd, servidor, io, pool, URL_BASE, tAdmin, idAdmin, idSur;
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

const crearCajero = async (id_sucursal = 1, { abrirCaja = true } = {}) => {
    const correo = `aviso${++n}@prueba.com`;
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, 2, $2, $3, $4) RETURNING id_usuario`, [id_sucursal, `CAJERO ${n}`, correo, await bcrypt.hash(CLAVE, 4)]);
    await api('PUT', `/permisos/usuario/${u.id_usuario}`, { token: tAdmin,
        body: { permisos: { inventario: true, punto_venta: true, mesas: true, arqueo: true } } });
    const cajero = { id: u.id_usuario, token: await iniciarSesion(correo, CLAVE), id_sucursal };
    if (abrirCaja) {
        const r = await api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal, monto_inicial: 100 } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    return cajero;
};

const crearProducto = async (stock, precio = 10, id_sucursal = 1) => {
    const [{ id }] = await bd.sql(`SELECT min(id_categoria) AS id FROM categoria_producto`);
    const r = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
        nombre_producto: `AVISO ${++n}`, precio_unitario: precio, id_categoria: id, id_sucursal, stock_inicial: stock } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.producto.id_producto;
};

const cobrar = (cajero, detalles, descuento) => api('POST', '/caja/cobrar',
    { token: cajero.token, body: { id_sucursal: cajero.id_sucursal, metodo_pago: 'Efectivo', detalles, descuento } });

const lista = async (token) => (await api('GET', '/notificaciones', { token })).body;
const deTipo = async (token, tipo) => (await lista(token)).notificaciones.filter(x => x.tipo === tipo);
const contar = async (tipo) => Number((await bd.sql(`SELECT COUNT(*) AS n FROM notificacion WHERE tipo = $1`, [tipo]))[0].n);

// Eventos enviados a la sala de cada usuario
const eventos = [];
const enviadasA = (id_usuario, tipo) => eventos.filter(e => e.sala === `usuario_${id_usuario}` && e.evento === 'notificacion:nueva'
                                                       && (!tipo || e.datos.tipo === tipo));
const esperarEnvios = () => new Promise(r => setTimeout(r, 80));

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idSur }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sur') RETURNING id_sucursal`);
    await bd.sql(`UPDATE configuracion SET stock_minimo_defecto = 3 WHERE id_configuracion = 1`);
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    [{ id_usuario: idAdmin }] = await bd.sql(`SELECT id_usuario FROM usuario WHERE correo_electronico = 'admin@rickys.com'`);

    const original = global.io.to.bind(global.io);
    global.io.to = (sala) => {
        const destino = original(sala);
        return { emit: (evento, datos) => { eventos.push({ sala, evento, datos }); return destino.emit(evento, datos); } };
    };
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Notificaciones', () => {
    let cajero, cajeroSur;

    before(async () => {
        cajero    = await crearCajero(1);
        cajeroSur = await crearCajero(idSur);
    });

    test('sin sesión → 401', async () => {
        assert.equal((await api('GET', '/notificaciones')).status, 401);
    });

    test('no pasan por la auditoría', async () => {
        const t = await bd.sql(`SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
                                WHERE c.relname IN ('notificacion', 'notificacion_leida') AND NOT g.tgisinternal`);
        assert.deepEqual(t, []);
    });

    test('stock bajo al cruzar el mínimo y agotado al llegar a 0; una sola vez; solo la sucursal y el administrador', async () => {
        const p = await crearProducto(5);
        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 2 }])).status, 201);   // 5 → 3: cruza el mínimo
        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 1 }])).status, 201);   // 3 → 2: ya estaba bajo
        await esperarEnvios();

        const bajos = (await deTipo(cajero.token, 'STOCK_BAJO')).filter(x => x.titulo.endsWith(`AVISO ${n}`));
        assert.equal(bajos.length, 1);
        assert.match(bajos[0].mensaje, /Quedan 3/);
        assert.equal(bajos[0].ruta, 'inventario');
        assert.equal(bajos[0].leida, false);
        assert.equal((await deTipo(tAdmin, 'STOCK_BAJO')).length, 1);
        assert.equal((await deTipo(cajeroSur.token, 'STOCK_BAJO')).length, 0);
        assert.equal(enviadasA(cajero.id, 'STOCK_BAJO').length, 1);
        assert.equal(enviadasA(idAdmin, 'STOCK_BAJO').length, 1);
        assert.equal(enviadasA(cajeroSur.id, 'STOCK_BAJO').length, 0);

        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 2 }])).status, 201);   // 2 → 0
        const agotados = await deTipo(cajero.token, 'AGOTADO');
        assert.equal(agotados.length, 1);
        assert.match(agotados[0].mensaje, /Sin stock en/);

        // Repuesto y vuelto a bajar enseguida: no se repite (3 horas)
        const r = await api('POST', '/inventario/movimientos', { token: cajero.token,
            body: { id_sucursal: 1, id_producto: p, tipo: 'INGRESO', cantidad: 5, motivo: 'Producción' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 2 }])).status, 201);
        assert.equal(await contar('STOCK_BAJO'), 1);
    });

    test('el carrito no avisa: recién al cobrar; si se vende todo de golpe solo «Agotado»', async () => {
        const p = await crearProducto(3);
        const nombre = `AVISO ${n}`;
        const deEste = async (tipo) => Number((await bd.sql(
            `SELECT COUNT(*) AS c FROM notificacion WHERE tipo = $1 AND titulo LIKE '%' || $2`, [tipo, nombre]))[0].c);
        // Apartar en el carrito deja el stock en 0, pero todavía no es venta
        assert.equal((await api('PUT', `/caja/reservas/${p}`, { token: cajero.token, body: { cantidad: 3 } })).status, 200);
        assert.equal(await deEste('AGOTADO'), 0);
        // Se devuelve: sin avisos falsos
        assert.equal((await api('PUT', `/caja/reservas/${p}`, { token: cajero.token, body: { cantidad: 0 } })).status, 200);
        assert.equal(await deEste('AGOTADO') + await deEste('STOCK_BAJO'), 0);
        // Se vende todo de golpe: solo agotado
        assert.equal((await api('PUT', `/caja/reservas/${p}`, { token: cajero.token, body: { cantidad: 3 } })).status, 200);
        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 3 }])).status, 201);
        assert.equal(await deEste('AGOTADO'), 1);
        assert.equal(await deEste('STOCK_BAJO'), 0);
    });

    test('mesas: avisa al cobrar la cuenta, no al cargar el producto', async () => {
        const p = await crearProducto(5);
        const nombre = `AVISO ${n}`;
        const deEste = async (tipo) => Number((await bd.sql(
            `SELECT COUNT(*) AS c FROM notificacion WHERE tipo = $1 AND titulo LIKE '%' || $2`, [tipo, nombre]))[0].c);
        const [m] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr) VALUES (1, 900 + $1, md5(random()::text)) RETURNING id_mesa`, [n]);
        const ab = await api('POST', '/cuentas/abrir', { token: cajero.token, body: { id_mesa: m.id_mesa } });
        assert.ok([200, 201].includes(ab.status), JSON.stringify(ab.body));
        const id_cuenta = ab.body.id_cuenta ?? ab.body.cuenta?.id_cuenta;
        const ag = await api('POST', `/cuentas/${id_cuenta}/producto`, { token: cajero.token, body: { id_producto: p, cantidad: 3 } });
        assert.ok([200, 201].includes(ag.status), JSON.stringify(ag.body));
        assert.equal(await deEste('STOCK_BAJO'), 0);   // 5 → 2 apartado en la mesa
        const c = await api('POST', `/cuentas/${id_cuenta}/cerrar`, { token: cajero.token, body: { metodo_pago: 'Efectivo' } });
        assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
        assert.equal(await deEste('STOCK_BAJO'), 1);
    });

    test('descuento manual: solo el administrador; si la venta falla no queda aviso', async () => {
        const p = await crearProducto(20, 50);
        const descuento = { tipo: 'PORCENTAJE', valor: 10, motivo: 'Cliente frecuente' };

        const falla = await cobrar(cajero, [{ id_producto: p, cantidad: 99 }], descuento);
        assert.equal(falla.status >= 400, true);
        assert.equal(await contar('DESCUENTO'), 0);

        assert.equal((await cobrar(cajero, [{ id_producto: p, cantidad: 1 }], descuento)).status, 201);
        await esperarEnvios();
        const [d] = await deTipo(tAdmin, 'DESCUENTO');
        assert.match(d.titulo, /Descuento manual de Bs\. 5\.00/);
        assert.match(d.mensaje, /Cliente frecuente/);
        assert.equal((await deTipo(cajero.token, 'DESCUENTO')).length, 0);
        assert.equal(enviadasA(idAdmin, 'DESCUENTO').length, 1);
        assert.equal(enviadasA(cajero.id, 'DESCUENTO').length, 0);
    });

    test('arqueo: avisa el faltante al administrador; sin diferencia no avisa', async () => {
        const cuadra = await crearCajero(1);
        assert.equal((await api('POST', '/caja/cerrar', { token: cuadra.token, body: { efectivo_contado: 100 } })).status, 200);
        assert.equal(await contar('ARQUEO'), 0);

        const falta = await crearCajero(1);
        const p = await crearProducto(10, 10);
        assert.equal((await cobrar(falta, [{ id_producto: p, cantidad: 1 }])).status, 201);
        assert.equal((await api('POST', '/caja/cerrar', { token: falta.token, body: { efectivo_contado: 100 } })).status, 200);
        const [a] = await deTipo(tAdmin, 'ARQUEO');
        assert.match(a.titulo, /Faltante en caja: Bs\. 10\.00/);
        assert.equal(a.ruta, 'cierres-caja');
        assert.equal((await deTipo(falta.token, 'ARQUEO')).length, 0);
    });

    test('caja sin cerrar: al cajero de ese turno y al administrador', async () => {
        const olvido = await crearCajero(1, { abrirCaja: false });
        const otro   = await crearCajero(1, { abrirCaja: false });
        await bd.sql(`INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, fecha_hora_apertura)
                      VALUES (1, $1, 50, CURRENT_DATE - INTERVAL '1 day' + INTERVAL '9 hours')`, [olvido.id]);
        await require('../../src/procesos/cierreDiario').ejecutar();
        await esperarEnvios();
        assert.equal((await deTipo(olvido.token, 'CAJA_SIN_CERRAR')).length, 1);
        assert.equal((await deTipo(tAdmin, 'CAJA_SIN_CERRAR')).length, 1);
        assert.equal((await deTipo(otro.token, 'CAJA_SIN_CERRAR')).length, 0);
        assert.equal(enviadasA(olvido.id, 'CAJA_SIN_CERRAR').length, 1);
    });

    test('transferencia: a la sucursal de destino y al administrador; quien la hizo no la tiene pendiente', async () => {
        const p = await crearProducto(10);
        const r = await api('POST', '/inventario/transferencias', { token: cajero.token,
            body: { id_sucursal_destino: idSur, items: [{ id_producto: p, cantidad: 4 }] } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        await esperarEnvios();
        const [t] = await deTipo(cajeroSur.token, 'TRANSFERENCIA');
        assert.match(t.mensaje, new RegExp(`4 AVISO ${n}`));
        assert.equal(t.leida, false);
        assert.equal((await deTipo(cajero.token, 'TRANSFERENCIA')).length, 0);
        assert.equal((await deTipo(tAdmin, 'TRANSFERENCIA')).length, 1);
        assert.equal(enviadasA(cajeroSur.id, 'TRANSFERENCIA').length, 1);
    });

    test('marcar como leídas: las indicadas, luego todas; nadie marca lo que no ve', async () => {
        const antes = await lista(cajeroSur.token);
        assert.ok(antes.no_leidas > 0);
        const [primera] = antes.notificaciones;

        const r = await api('POST', '/notificaciones/leidas', { token: cajeroSur.token, body: { ids: [primera.id_notificacion] } });
        assert.equal(r.status, 200);
        assert.equal(r.body.no_leidas, antes.no_leidas - 1);
        assert.equal(r.body.notificaciones.find(x => x.id_notificacion === primera.id_notificacion).leida, true);

        const [soloAdmin] = await deTipo(tAdmin, 'DESCUENTO');
        await api('POST', '/notificaciones/leidas', { token: cajeroSur.token, body: { ids: [soloAdmin.id_notificacion] } });
        assert.equal(Number((await bd.sql(`SELECT COUNT(*) AS n FROM notificacion_leida WHERE id_notificacion = $1 AND id_usuario = $2`,
                                          [soloAdmin.id_notificacion, cajeroSur.id]))[0].n), 0);

        const todas = await api('POST', '/notificaciones/leidas', { token: cajeroSur.token, body: {} });
        assert.equal(todas.body.no_leidas, 0);
        assert.equal((await api('GET', '/notificaciones?no_leidas=1', { token: cajeroSur.token })).body.notificaciones.length, 0);
        assert.ok((await lista(tAdmin)).no_leidas > 0);
    });

    test('se borran a los 7 días', async () => {
        await bd.sql(`UPDATE notificacion SET fecha_creacion = CURRENT_TIMESTAMP - INTERVAL '8 days' WHERE tipo = 'TRANSFERENCIA'`);
        await require('../../src/models/notificacionModel').limpiarAntiguas();
        assert.equal(await contar('TRANSFERENCIA'), 0);
        assert.ok(await contar('AGOTADO') > 0);
    });
});
