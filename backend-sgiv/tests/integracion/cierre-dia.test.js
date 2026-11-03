const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Cierre del día (00:00): cierre automático de caja y lista de productos que quedaron ───
// Levantan el backend real contra una BD temporal.

let bd, servidor, io, pool, URL_BASE, cierreDiario;
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

const crearCajero = async (correo, id_sucursal = 1) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, 2, $2, $2, $3) RETURNING id_usuario`, [id_sucursal, correo, hash]);
    await api('PUT', `/permisos/usuario/${u.id_usuario}`,
        { token: tAdmin, body: { permisos: { inventario: true, punto_venta: true, mesas: true } } });
    return { id: u.id_usuario, token: await iniciarSesion(correo, CLAVE) };
};

const crearProducto = async (nombre, cantidad, id_sucursal = 1, activo = true) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario, estado_activo)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, 10, $2) RETURNING id_producto`, [nombre, activo]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, $3)`,
                 [id_sucursal, p.id_producto, cantidad]);
    return p.id_producto;
};

const turno = async (id_turno) => (await bd.sql(`SELECT * FROM turno_caja WHERE id_turno = $1`, [id_turno]))[0];

let tAdmin, idSucursal2;

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idSucursal2 }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sur') RETURNING id_sucursal`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    cierreDiario  = require('../../src/procesos/cierreDiario');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Cierre automático de caja a las 00:00', () => {
    test('cierra los turnos de días anteriores a su medianoche, como «Sistema», sin tocar los de hoy', async () => {
        const ayer = await crearCajero('cajero.ayer@prueba.com');
        const hoy  = await crearCajero('cajero.hoy@prueba.com');
        const prod = await crearProducto('Torta cierre', 20);

        const t1 = (await api('POST', '/caja/turnos/abrir', { token: ayer.token, body: { id_sucursal: 1, monto_inicial: 100 } })).body.turno;
        const venta = await api('POST', '/caja/cobrar', { token: ayer.token,
            body: { id_sucursal: 1, metodo_pago: 'Efectivo', detalles: [{ id_producto: prod, cantidad: 2 }] } });
        assert.equal(venta.status, 201);
        // El turno quedó abierto desde ayer a las 18:00
        await bd.sql(`UPDATE turno_caja SET fecha_hora_apertura = CURRENT_DATE - INTERVAL '6 hours' WHERE id_turno = $1`, [t1.id_turno]);
        const t2 = (await api('POST', '/caja/turnos/abrir', { token: hoy.token, body: { id_sucursal: 1, monto_inicial: 50 } })).body.turno;

        await cierreDiario.ejecutar();

        const cerrado = await turno(t1.id_turno);
        assert.equal(cerrado.estado_turno, 'Cerrado');
        assert.equal(cerrado.cerrado_por, 'Sistema');
        assert.equal(Number(cerrado.monto_calculado), 120);
        assert.equal(cerrado.monto_real_declarado, null);
        const [{ medianoche }] = await bd.sql(`SELECT $1::timestamp = CURRENT_DATE::timestamp AS medianoche`, [cerrado.fecha_hora_cierre]);
        assert.ok(medianoche);
        assert.equal((await bd.sql(`SELECT 1 FROM turno_caja WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'`, [ayer.id])).length, 0);
        assert.equal((await turno(t2.id_turno)).estado_turno, 'Abierto');

        // El cajero ve que su caja la cerró el sistema; sin turno no puede vender
        const estado = (await api('GET', '/caja/estado-completo', { token: ayer.token })).body;
        assert.equal(estado.estado, 'SIN_APERTURA');
        assert.equal(estado.cierre_sistema.id_turno, t1.id_turno);
        const sinTurno = await api('POST', '/caja/cobrar', { token: ayer.token,
            body: { id_sucursal: 1, metodo_pago: 'Efectivo', detalles: [{ id_producto: prod, cantidad: 1 }] } });
        assert.notEqual(sinTurno.status, 201);

        const cierres = (await api('GET', '/caja/cierres', { token: tAdmin })).body;
        assert.equal(cierres.find(c => c.id_turno === t1.id_turno).cerrado_por, 'Sistema');

        // Volver a correr no cambia nada
        await cierreDiario.ejecutar();
        assert.equal((await turno(t2.id_turno)).estado_turno, 'Abierto');
    });

    test('registra si cerró el cajero o el administrador; las cuentas de mesa abiertas siguen abiertas', async () => {
        const cajero = await crearCajero('cajero.cierra@prueba.com');
        const otro   = await crearCajero('cajero.admin@prueba.com');
        const ta = (await api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal: 1, monto_inicial: 10 } })).body.turno;
        const tb = (await api('POST', '/caja/turnos/abrir', { token: otro.token, body: { id_sucursal: 1, monto_inicial: 10 } })).body.turno;

        assert.equal((await api('POST', '/caja/cerrar', { token: cajero.token, body: { id_sucursal: 1 } })).status, 200);
        assert.equal((await turno(ta.id_turno)).cerrado_por, 'Cajero');
        assert.equal((await api('PATCH', `/caja/deshabilitar/${otro.id}`, { token: tAdmin })).status, 200);
        assert.equal((await turno(tb.id_turno)).cerrado_por, 'Administrador');

        // Cuenta de mesa abierta de ayer: el cierre del día no la toca
        const [mesa] = await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr, estado_mesa)
                                     VALUES (1, 90, md5(random()::text), 'Ocupada') RETURNING id_mesa`);
        const [cuenta] = await bd.sql(`INSERT INTO cuenta_mesa (id_mesa, estado, fecha_apertura)
                                       VALUES ($1, 'Abierta', CURRENT_DATE - INTERVAL '2 hours') RETURNING id_cuenta`, [mesa.id_mesa]);
        await cierreDiario.ejecutar();
        assert.equal((await bd.sql(`SELECT estado FROM cuenta_mesa WHERE id_cuenta = $1`, [cuenta.id_cuenta]))[0].estado, 'Abierta');
    });
});
