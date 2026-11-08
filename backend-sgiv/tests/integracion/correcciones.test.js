const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Correcciones de la auditoría de cálculos, stock y caja ───
// Las carreras se fuerzan con una segunda conexión que deja una transacción a medias
// (como otra caja a mitad de su operación) mientras el sistema atiende la petición real.

let bd, servidor, io, pool, URL_BASE, tAdmin, idAdmin, idSucursal2;
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
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/** Transacción a medias en otra conexión: devuelve { sql, confirmar } */
const transaccionAbierta = async () => {
    const c = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
                           password: process.env.DB_PASSWORD, database: bd.nombre });
    await c.connect();
    await c.query("SET TIME ZONE 'America/La_Paz'");
    await c.query('BEGIN');
    return {
        sql: (texto, params) => c.query(texto, params).then(r => r.rows),
        confirmar: async () => { await c.query('COMMIT'); await c.end(); }
    };
};

/** La petición empieza, la otra transacción termina a los 300 ms y se espera la respuesta */
const enCarrera = async (otra, peticion) => {
    const p = peticion();
    await esperar(300);
    await otra.confirmar();
    return p;
};

const crearCajero = async (id_sucursal = 1) => {
    const correo = `cajero${++n}@prueba.com`;
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, 2, $2, $2, $3) RETURNING id_usuario`, [id_sucursal, correo, hash]);
    await api('PUT', `/permisos/usuario/${u.id_usuario}`,
        { token: tAdmin, body: { permisos: { inventario: true, punto_venta: true, mesas: true, arqueo: true } } });
    return { id: u.id_usuario, token: await iniciarSesion(correo, CLAVE), id_sucursal };
};

const abrirCaja = async (usuario, monto_inicial = 0) => {
    const r = await api('POST', '/caja/turnos/abrir', { token: usuario.token, body: { id_sucursal: usuario.id_sucursal, monto_inicial } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.turno.id_turno;
};

const crearProducto = async (stock, id_sucursal = 1, precio = 10) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, $2) RETURNING id_producto`, [`PRODUCTO ${++n}`, precio]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, $3)`,
                 [id_sucursal, p.id_producto, stock]);
    return p.id_producto;
};

const stock = async (id_producto, id_sucursal = 1) =>
    (await bd.sql(`SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`,
                  [id_producto, id_sucursal]))[0].cantidad_actual;

const turno = async (id_turno) => (await bd.sql(
    `SELECT estado_turno, monto_calculado::float8 AS esperado, monto_real_declarado::float8 AS contado,
            diferencia::float8 AS diferencia FROM turno_caja WHERE id_turno = $1`, [id_turno]))[0];

const crearMesa = async (id_sucursal = 1) => (await bd.sql(
    `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr) VALUES ($1, $2, $3) RETURNING id_mesa`,
    [id_sucursal, 100 + (++n), `qr-correccion-${n}`]))[0].id_mesa;

const abrirCuenta = async (usuario, id_mesa) => {
    const r = await api('POST', '/cuentas/abrir', { token: usuario.token, body: { id_mesa } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.cuenta.id_cuenta;
};

const agregar = (usuario, id_cuenta, id_producto, cantidad = 1) =>
    api('POST', `/cuentas/${id_cuenta}/producto`, { token: usuario.token, body: { id_producto, cantidad } });

/** Lo que hace otra caja al confirmar un pedido QR: bloquea la cuenta y le agrega un producto reservado */
const reservarEnOtraConexion = async (id_cuenta, id_producto, id_sucursal = 1) => {
    const otra = await transaccionAbierta();
    await otra.sql(`SELECT id_cuenta FROM cuenta_mesa WHERE id_cuenta = $1 FOR UPDATE`, [id_cuenta]);
    await otra.sql(`UPDATE inventario_sucursal SET cantidad_actual = cantidad_actual - 1 WHERE id_producto = $1 AND id_sucursal = $2`,
                   [id_producto, id_sucursal]);
    await otra.sql(`INSERT INTO detalle_cuenta (id_cuenta, id_producto, cantidad, precio_unitario)
                    VALUES ($1, $2, 1, 10)`, [id_cuenta, id_producto]);
    return otra;
};

const cobrar = (usuario, id_producto, cantidad = 1) => api('POST', '/caja/cobrar', {
    token: usuario.token,
    body: { id_sucursal: usuario.id_sucursal, metodo_pago: 'Efectivo', detalles: [{ id_producto, cantidad }] }
});

/** Eventos enviados a salas (io.to(sala).emit) */
const eventos = [];
const espiarSalas = () => {
    const original = global.io.to.bind(global.io);
    global.io.to = (sala) => {
        const destino = original(sala);
        return { emit: (evento, datos) => { eventos.push({ sala, evento, datos }); return destino.emit(evento, datos); } };
    };
};

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idSucursal2 }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sur') RETURNING id_sucursal`);
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    [{ id_usuario: idAdmin }] = await bd.sql(`SELECT id_usuario FROM usuario WHERE correo_electronico = 'admin@rickys.com'`);
    espiarSalas();
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('A1 · Agregar a una cuenta que se está cobrando', () => {
    test('no deja un producto reservado en una cuenta ya pagada', async () => {
        const cajero = await crearCajero();
        await abrirCaja(cajero);
        const id_producto = await crearProducto(10);
        const id_cuenta = await abrirCuenta(cajero, await crearMesa());
        assert.equal((await agregar(cajero, id_cuenta, id_producto)).status, 201);

        // Otra caja cobra la cuenta completa (la cuenta queda bloqueada hasta su COMMIT)
        const otra = await transaccionAbierta();
        await otra.sql(`SELECT id_cuenta FROM cuenta_mesa WHERE id_cuenta = $1 FOR UPDATE`, [id_cuenta]);
        await otra.sql(`UPDATE cuenta_mesa SET estado = 'Pagada' WHERE id_cuenta = $1`, [id_cuenta]);

        const r = await enCarrera(otra, () => agregar(cajero, id_cuenta, id_producto));
        assert.equal(r.status, 404, 'la cuenta ya no está abierta');
        assert.equal(await stock(id_producto), 9, 'solo la primera unidad quedó reservada');
        const [{ total }] = await bd.sql(`SELECT SUM(cantidad)::int AS total FROM detalle_cuenta WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(total, 1);
    });
});

describe('A2 · Cancelar, reiniciar o eliminar mientras se confirma un pedido', () => {
    test('«cancelar cuenta vacía» no cancela una cuenta que acaba de recibir un pedido', async () => {
        const cajero = await crearCajero();
        await abrirCaja(cajero);
        const id_producto = await crearProducto(5);
        const id_cuenta = await abrirCuenta(cajero, await crearMesa());

        const otra = await reservarEnOtraConexion(id_cuenta, id_producto);
        const r = await enCarrera(otra, () => api('POST', `/cuentas/${id_cuenta}/cancelar-si-vacia`, { token: cajero.token }));
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'CUENTA_NO_VACIA');
        const [c] = await bd.sql(`SELECT estado FROM cuenta_mesa WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(c.estado, 'Abierta');
    });

    test('«reiniciar mesa» devuelve también lo que llegó a la cuenta en ese momento', async () => {
        const cajero = await crearCajero();
        await abrirCaja(cajero);
        const p1 = await crearProducto(5), p2 = await crearProducto(5);
        const id_mesa = await crearMesa();
        const id_cuenta = await abrirCuenta(cajero, id_mesa);
        assert.equal((await agregar(cajero, id_cuenta, p1)).status, 201);

        const otra = await reservarEnOtraConexion(id_cuenta, p2);
        const r = await enCarrera(otra, () => api('POST', '/cuentas/reset-mesa', { token: tAdmin, body: { id_mesa } }));
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await stock(p1), 5);
        assert.equal(await stock(p2), 5, 'el producto que llegó durante el reinicio también vuelve');
    });

    test('«eliminar mesa» devuelve también lo que llegó a la cuenta en ese momento', async () => {
        const cajero = await crearCajero();
        await abrirCaja(cajero);
        const p1 = await crearProducto(5), p2 = await crearProducto(5);
        const id_mesa = await crearMesa();
        const id_cuenta = await abrirCuenta(cajero, id_mesa);
        assert.equal((await agregar(cajero, id_cuenta, p1)).status, 201);

        const otra = await reservarEnOtraConexion(id_cuenta, p2);
        const r = await enCarrera(otra, () => api('DELETE', `/mesas/${id_mesa}`, { token: tAdmin }));
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await stock(p1), 5);
        assert.equal(await stock(p2), 5);
    });
});

describe('A3 · Ventas y cierre de caja al mismo tiempo', () => {
    test('el cierre espera a la venta en curso y la cuenta en el efectivo esperado', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 100);

        const otra = await transaccionAbierta();
        await otra.sql(`INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_turno, monto_total_venta, metodo_pago)
                        VALUES (1, $1, $2, 50, 'Efectivo')`, [cajero.id, id_turno]);
        const r = await enCarrera(otra, () => api('POST', '/caja/cerrar', { token: cajero.token, body: { efectivo_contado: 150 } }));
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const t = await turno(id_turno);
        assert.equal(t.esperado, 150);
        assert.equal(t.diferencia, 0);
    });

    test('una venta que llega mientras se cierra la caja se rechaza (no entra a un turno cerrado)', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 100);
        const id_producto = await crearProducto(5);

        const otra = await transaccionAbierta();
        await otra.sql(`SELECT id_turno FROM turno_caja WHERE id_turno = $1 FOR UPDATE`, [id_turno]);
        await otra.sql(`UPDATE turno_caja SET estado_turno = 'Cerrado', fecha_hora_cierre = NOW() WHERE id_turno = $1`, [id_turno]);
        const r = await enCarrera(otra, () => cobrar(cajero, id_producto));
        assert.equal(r.status, 403);
        assert.equal(r.body.error, 'CAJA_CERRADA');
        assert.equal(await stock(id_producto), 5);
        assert.equal((await bd.sql(`SELECT 1 FROM venta_caja WHERE id_turno = $1`, [id_turno])).length, 0);
    });

    test('el cobro de una mesa que llega mientras se cierra la caja se rechaza', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 0);
        const id_producto = await crearProducto(5);
        const id_cuenta = await abrirCuenta(cajero, await crearMesa());
        assert.equal((await agregar(cajero, id_cuenta, id_producto)).status, 201);

        const otra = await transaccionAbierta();
        await otra.sql(`SELECT id_turno FROM turno_caja WHERE id_turno = $1 FOR UPDATE`, [id_turno]);
        await otra.sql(`UPDATE turno_caja SET estado_turno = 'Cerrado', fecha_hora_cierre = NOW() WHERE id_turno = $1`, [id_turno]);
        const r = await enCarrera(otra, () => api('POST', `/cuentas/${id_cuenta}/cerrar`,
                                                  { token: cajero.token, body: { metodo_pago: 'Efectivo' } }));
        assert.equal(r.status, 403);
        assert.equal((await bd.sql(`SELECT 1 FROM venta_caja WHERE id_turno = $1`, [id_turno])).length, 0);
    });
});

describe('A4 · M4 · Cierre de caja por el administrador', () => {
    test('calcula el efectivo esperado y avisa al cajero', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 100);
        const id_producto = await crearProducto(5, 1, 15);
        assert.equal((await cobrar(cajero, id_producto, 2)).status, 201);

        eventos.length = 0;
        const r = await api('PATCH', `/caja/deshabilitar/${cajero.id}`, { token: tAdmin });
        assert.equal(r.status, 200);
        const t = await turno(id_turno);
        assert.equal(t.estado_turno, 'Cerrado');
        assert.equal(t.esperado, 130);
        assert.ok(eventos.some(e => e.sala === `usuario_${cajero.id}` && e.evento === 'caja:cerrada'), 'aviso al cajero');
    });
});

describe('A5 · Reabrir un turno', () => {
    test('limpia el conteo y la diferencia del cierre anterior', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 100);
        assert.equal((await api('POST', '/caja/cerrar', { token: cajero.token, body: { efectivo_contado: 90 } })).status, 200);
        assert.equal((await turno(id_turno)).diferencia, -10);

        assert.equal((await api('POST', `/caja/reabrir/${cajero.id}`, { token: tAdmin })).status, 200);
        const t = await turno(id_turno);
        assert.equal(t.estado_turno, 'Abierto');
        assert.equal(t.esperado, null);
        assert.equal(t.contado, null);
        assert.equal(t.diferencia, null);
    });
});

describe('A6 · Turno de un día anterior (antes del cierre automático)', () => {
    test('no acepta ventas de caja ni cobros de mesa', async () => {
        const cajero = await crearCajero();
        const id_turno = await abrirCaja(cajero, 0);
        const id_producto = await crearProducto(5);
        const id_cuenta = await abrirCuenta(cajero, await crearMesa());
        assert.equal((await agregar(cajero, id_cuenta, id_producto)).status, 201);
        await bd.sql(`UPDATE turno_caja SET fecha_hora_apertura = CURRENT_DATE - INTERVAL '1 hour' WHERE id_turno = $1`, [id_turno]);

        const r = await cobrar(cajero, id_producto);
        assert.equal(r.status, 403);
        const m = await api('POST', `/cuentas/${id_cuenta}/cerrar`, { token: cajero.token, body: { metodo_pago: 'Efectivo' } });
        assert.equal(m.status, 403);
        assert.equal((await bd.sql(`SELECT 1 FROM venta_caja WHERE id_turno = $1`, [id_turno])).length, 0);
    });
});

describe('A7 · Cobrar una mesa de otra sucursal', () => {
    test('se rechaza si la caja abierta es de otra sucursal', async () => {
        await abrirCaja({ token: tAdmin, id_sucursal: 1 }, 0);
        try {
            const id_producto = await crearProducto(5, idSucursal2);
            const id_cuenta = await abrirCuenta({ token: tAdmin }, await crearMesa(idSucursal2));
            assert.equal((await agregar({ token: tAdmin }, id_cuenta, id_producto)).status, 201);

            const r = await api('POST', `/cuentas/${id_cuenta}/cerrar`, { token: tAdmin, body: { metodo_pago: 'Efectivo' } });
            assert.equal(r.status, 409, JSON.stringify(r.body));
            assert.equal((await bd.sql(`SELECT 1 FROM venta_caja WHERE id_usuario_cajero = $1`, [idAdmin])).length, 0);
        } finally {
            await api('POST', '/caja/cerrar', { token: tAdmin, body: {} });
        }
    });
});

describe('M1 · D2 · Abrir caja dos veces a la vez', () => {
    test('queda un solo turno abierto', async () => {
        const cajero = await crearCajero();
        // Otra pestaña abrió la caja y su transacción todavía no terminó
        const otra = await transaccionAbierta();
        await otra.sql(`INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
                        VALUES (1, $1, 0, 'Abierto')`, [cajero.id]);
        const r = await enCarrera(otra, () =>
            api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal: 1, monto_inicial: 0 } }));
        assert.equal(r.status, 400, JSON.stringify(r.body));
        const [{ abiertos }] = await bd.sql(
            `SELECT COUNT(*)::int AS abiertos FROM turno_caja WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'`, [cajero.id]);
        assert.equal(abiertos, 1);
    });
});

describe('D1 · El stock nunca queda negativo en la base de datos', () => {
    test('la BD rechaza un stock negativo', async () => {
        const id_producto = await crearProducto(1);
        await assert.rejects(
            bd.sql(`UPDATE inventario_sucursal SET cantidad_actual = -1 WHERE id_producto = $1`, [id_producto]),
            (e) => e.code === '23514');
    });
});

describe('B1 · B2 · Fondo inicial y resumen del arqueo', () => {
    test('el fondo inicial no puede ser negativo', async () => {
        const cajero = await crearCajero();
        const r = await api('POST', '/caja/turnos/abrir', { token: cajero.token, body: { id_sucursal: 1, monto_inicial: -50 } });
        assert.equal(r.status, 400);
    });

    test('el efectivo esperado del arqueo es exacto al centavo', async () => {
        const cajero = await crearCajero();
        await abrirCaja(cajero, 10.1);
        const a = await crearProducto(5, 1, 0.1), b = await crearProducto(5, 1, 0.2);
        assert.equal((await cobrar(cajero, a)).status, 201);
        assert.equal((await cobrar(cajero, b)).status, 201);
        const r = await api('GET', '/caja/arqueo/1', { token: cajero.token });
        assert.equal(r.status, 200);
        assert.equal(r.body.turno_resumen.efectivo, 0.3);
        assert.equal(r.body.turno_resumen.total, 0.3);
        assert.equal(r.body.turno_resumen.efectivo_esperado, 10.4);
    });
});

describe('B3 · Producto nuevo con stock inicial', () => {
    test('el stock y su historial quedan juntos', async () => {
        const r = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
            nombre_producto: 'PRODUCTO CON STOCK', precio_unitario: 5, id_sucursal: 1, stock_inicial: 7,
            id_categoria: (await bd.sql(`SELECT min(id_categoria) AS id FROM categoria_producto`))[0].id } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const [h] = await bd.sql(`
            SELECT i.cantidad_actual, h.stock_resultante, h.motivo_movimiento FROM inventario_sucursal i
            JOIN historial_inventario h ON h.id_inventario = i.id_inventario WHERE i.id_producto = $1`, [r.body.producto.id_producto]);
        assert.equal(h.cantidad_actual, 7);
        assert.equal(h.stock_resultante, 7);
        assert.equal(h.motivo_movimiento, 'Stock inicial');
    });
});
