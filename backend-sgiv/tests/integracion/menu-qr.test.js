const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');

// ─── Pruebas del menú digital QR (cliente → cajero) ───
// Levantan el backend real contra una BD temporal.

process.env.MENU_MAX_PEDIDOS_IP = '1000';

let bd, servidor, io, pool, URL_BASE;
const CLAVE = 'Prueba123';

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    return { status: r.status, body: datos, headers: r.headers };
};

const iniciarSesion = crearLogin((...a) => api(...a));
const login = (correo, contrasena = CLAVE) => iniciarSesion(correo, contrasena);

const crearUsuario = async (correo, id_rol) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES (1, $1, $2, $2, $3) RETURNING id_usuario`, [id_rol, correo, hash]);
    return u.id_usuario;
};

const crearProducto = async (nombre, precio, cantidad, id_sucursal = 1) => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, $2) RETURNING id_producto`,
        [nombre, precio]);
    await bd.sql(
        `INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, $3)`,
        [id_sucursal, p.id_producto, cantidad]);
    return p.id_producto;
};

const stock = async (id_producto, id_sucursal = 1) => {
    const [r] = await bd.sql(
        `SELECT cantidad_actual FROM inventario_sucursal WHERE id_sucursal = $1 AND id_producto = $2`,
        [id_sucursal, id_producto]);
    return Number(r.cantidad_actual);
};

const crearMesa = async (numero, id_sucursal = 1) => {
    const [m] = await bd.sql(
        `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
         VALUES ($1, $2, md5(random()::text)) RETURNING id_mesa, codigo_qr`, [id_sucursal, numero]);
    return m;
};

const pedir = (codigo, items, extra = {}) =>
    api('POST', `/menu/m/${codigo}/pedidos`, { body: { items, ...extra } });

const estadoPedido = async (id_pedido) =>
    (await bd.sql(`SELECT * FROM pedido_mesa WHERE id_pedido = $1`, [id_pedido]))[0];

let tCajero, tAdmin;

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sucursal sin turno')`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    await crearUsuario('cajero.qr@prueba.com', 2);
    tCajero = await login('cajero.qr@prueba.com');
    tAdmin  = await login('admin@rickys.com', 'password');
    // El menú solo recibe pedidos con un turno de caja abierto en la sucursal
    const turno = await api('POST', '/caja/turnos/abrir', { token: tCajero, body: { id_sucursal: 1, monto_inicial: 100 } });
    assert.equal(turno.status, 201);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

// ─── Acceso al menú ───
describe('Menú QR: acceso', () => {
    test('código inexistente → 404; el id interno de la mesa no sirve como código', async () => {
        const mesa = await crearMesa(1);
        assert.equal((await api('GET', '/menu/m/no-existe')).status, 404);
        assert.equal((await api('GET', `/menu/m/${mesa.id_mesa}`)).status, 404);
    });

    test('datos de la mesa y catálogo (incluye agotados con stock 0)', async () => {
        const mesa     = await crearMesa(2);
        const visible  = await crearProducto('Torta QR', 30, 5);
        const agotado  = await crearProducto('Agotado QR', 10, 0);
        const oculto   = await crearProducto('Oculto QR', 10, 5);
        await bd.sql(`UPDATE producto SET mostrar_en_menu = FALSE WHERE id_producto = $1`, [oculto]);

        const info = await api('GET', `/menu/m/${mesa.codigo_qr}`);
        assert.equal(info.status, 200);
        assert.equal(info.body.numero_mesa, 2);
        assert.equal(info.body.recibe_pedidos, true);
        assert.equal(info.body.id_mesa, undefined);           // no se expone el id interno

        const cat = await api('GET', `/menu/m/${mesa.codigo_qr}/catalogo`);
        const ids = cat.body.map(p => p.id_producto);
        assert.ok(ids.includes(visible));
        assert.equal(cat.body.find(p => p.id_producto === agotado).stock_actual, 0);
        assert.ok(!ids.includes(oculto));
    });

    test('sucursal sin turno de caja abierto → no recibe pedidos ni toca el stock', async () => {
        const mesa = await crearMesa(1, 2);
        const prod = await crearProducto('Sin turno QR', 10, 5, 2);
        assert.equal((await api('GET', `/menu/m/${mesa.codigo_qr}`)).body.recibe_pedidos, false);

        const r = await pedir(mesa.codigo_qr, [{ id_producto: prod, cantidad: 1 }]);
        assert.equal(r.status, 409);
        assert.equal(r.body.codigo, 'NO_RECIBE_PEDIDOS');
        assert.equal(await stock(prod, 2), 5);
    });
});

// ─── Crear pedido ───
describe('Menú QR: crear pedido', () => {
    let mesa, torta, cafe;

    before(async () => {
        mesa  = await crearMesa(10);
        torta = await crearProducto('Torta pedido', 25.50, 10);
        cafe  = await crearProducto('Café pedido', 8, 3);
    });

    test('reserva stock al instante, usa el precio de la BD y junta productos repetidos', async () => {
        const r = await pedir(mesa.codigo_qr, [
            { id_producto: torta, cantidad: 1, precio_unitario: 0.01, nota_cliente: 'sin crema' },
            { id_producto: torta, cantidad: 1, nota_cliente: 'con vela' }
        ]);
        assert.equal(r.status, 201);
        assert.equal(Number(r.body.monto_total), 51);
        assert.equal(await stock(torta), 8);

        const ped = await estadoPedido(r.body.id_pedido);
        assert.equal(ped.estado_pedido, 'Pendiente_Cajero');
        assert.equal(ped.tipo_pedido, 'Mesa');
        assert.equal(ped.id_sucursal, 1);

        const det = await bd.sql(`SELECT * FROM detalle_pedido WHERE id_pedido = $1`, [r.body.id_pedido]);
        assert.equal(det.length, 1);
        assert.equal(det[0].cantidad_solicitada, 2);
        assert.equal(det[0].nota_cliente, 'sin crema; con vela');

        // La mesa no se marca ocupada hasta que el cajero confirma
        const [m] = await bd.sql(`SELECT estado_mesa FROM mesa_local WHERE id_mesa = $1`, [mesa.id_mesa]);
        assert.equal(m.estado_mesa, 'Libre');
    });

    test('si un producto no alcanza, no se reserva nada del pedido', async () => {
        const antesTorta = await stock(torta);
        const r = await pedir(mesa.codigo_qr, [
            { id_producto: torta, cantidad: 1 },
            { id_producto: cafe,  cantidad: 4 }
        ]);
        assert.equal(r.status, 409);
        assert.equal(r.body.codigo, 'STOCK_INSUFICIENTE');
        assert.equal(r.body.disponible, 3);
        assert.equal(await stock(torta), antesTorta);
        assert.equal(await stock(cafe), 3);
    });

    test('dos mesas piden la última unidad a la vez: solo una la obtiene', async () => {
        const ultima = await crearProducto('Última unidad', 15, 1);
        const mesaA  = await crearMesa(12);
        const mesaB  = await crearMesa(13);
        const [a, b] = await Promise.all([
            pedir(mesaA.codigo_qr, [{ id_producto: ultima, cantidad: 1 }]),
            pedir(mesaB.codigo_qr, [{ id_producto: ultima, cantidad: 1 }])
        ]);
        assert.deepEqual([a.status, b.status].sort(), [201, 409]);
        assert.equal(await stock(ultima), 0);
    });

    test('rechaza carrito vacío, cantidades inválidas y productos inactivos', async () => {
        assert.equal((await pedir(mesa.codigo_qr, [])).status, 400);
        assert.equal((await pedir(mesa.codigo_qr, [{ id_producto: torta, cantidad: 0 }])).status, 400);
        assert.equal((await pedir(mesa.codigo_qr, [{ id_producto: torta, cantidad: 1.5 }])).status, 400);
        assert.equal((await pedir(mesa.codigo_qr, [{ id_producto: torta, cantidad: -2 }])).status, 400);

        const inactivo = await crearProducto('Inactivo pedido', 5, 5);
        await bd.sql(`UPDATE producto SET estado_activo = FALSE WHERE id_producto = $1`, [inactivo]);
        const r = await pedir(mesa.codigo_qr, [{ id_producto: inactivo, cantidad: 1 }]);
        assert.equal(r.status, 409);
        assert.equal(r.body.codigo, 'PRODUCTO_NO_DISPONIBLE');
        assert.equal(await stock(inactivo), 5);
    });

    test(`una mesa no puede tener más de 3 pedidos esperando confirmación`, async () => {
        const otra = await crearMesa(11);
        const prod = await crearProducto('Límite pedido', 1, 20);
        for (let i = 0; i < 3; i++)
            assert.equal((await pedir(otra.codigo_qr, [{ id_producto: prod, cantidad: 1 }])).status, 201);
        const r = await pedir(otra.codigo_qr, [{ id_producto: prod, cantidad: 1 }]);
        assert.equal(r.status, 429);
        assert.equal(r.body.codigo, 'DEMASIADOS_PENDIENTES');
        assert.equal(await stock(prod), 17);
    });
});

// ─── Bandeja del cajero ───
describe('Menú QR: bandeja del cajero', () => {
    let mesa, pan, jugo;

    before(async () => {
        mesa = await crearMesa(20);
        pan  = await crearProducto('Pan bandeja', 2, 10);
        jugo = await crearProducto('Jugo bandeja', 7, 10);
    });

    test('requiere sesión y permiso del módulo mesas', async () => {
        assert.equal((await api('GET', '/pedidos/bandeja')).status, 401);

        const id = await crearUsuario('sin.mesas@prueba.com', 2);
        await bd.sql(`INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso) VALUES ($1, 'mesas', FALSE)`, [id]);
        const t = await login('sin.mesas@prueba.com');
        assert.equal((await api('GET', '/pedidos/bandeja', { token: t })).status, 403);
    });

    test('el cajero ve el pedido con sus productos y puede ajustarlo (el stock acompaña)', async () => {
        const r = await pedir(mesa.codigo_qr, [
            { id_producto: pan,  cantidad: 2 },
            { id_producto: jugo, cantidad: 1 }
        ]);
        const id_pedido = r.body.id_pedido;
        assert.equal(await stock(pan), 8);

        const bandeja = await api('GET', '/pedidos/bandeja', { token: tCajero });
        assert.equal(bandeja.status, 200);
        const p = bandeja.body.find(x => x.id_pedido === id_pedido);
        assert.equal(p.numero_mesa, 20);
        assert.equal(p.items.length, 2);
        const detPan  = p.items.find(i => i.id_producto === pan).id_detalle;
        const detJugo = p.items.find(i => i.id_producto === jugo).id_detalle;

        const subir = await api('PATCH', `/pedidos/${id_pedido}/detalle/${detPan}`, { token: tCajero, body: { cantidad: 5 } });
        assert.equal(subir.status, 200);
        assert.equal(Number(subir.body.monto_total), 17);
        assert.equal(await stock(pan), 5);

        const exceso = await api('PATCH', `/pedidos/${id_pedido}/detalle/${detPan}`, { token: tCajero, body: { cantidad: 20 } });
        assert.equal(exceso.status, 409);
        assert.equal(await stock(pan), 5);

        const bajar = await api('PATCH', `/pedidos/${id_pedido}/detalle/${detPan}`, { token: tCajero, body: { cantidad: 1 } });
        assert.equal(Number(bajar.body.monto_total), 9);
        assert.equal(await stock(pan), 9);

        const quitar = await api('PATCH', `/pedidos/${id_pedido}/detalle/${detJugo}`, { token: tCajero, body: { cantidad: 0 } });
        assert.equal(Number(quitar.body.monto_total), 2);
        assert.equal(await stock(jugo), 10);

        const ultimo = await api('PATCH', `/pedidos/${id_pedido}/detalle/${detPan}`, { token: tCajero, body: { cantidad: 0 } });
        assert.equal(ultimo.status, 400);
        assert.equal(ultimo.body.codigo, 'ULTIMO_PRODUCTO');
    });

    test('rechazar devuelve el stock y no se puede volver a procesar', async () => {
        const r = await pedir(mesa.codigo_qr, [{ id_producto: jugo, cantidad: 4 }]);
        assert.equal(await stock(jugo), 6);

        const rech = await api('POST', `/pedidos/${r.body.id_pedido}/rechazar`, { token: tCajero });
        assert.equal(rech.status, 200);
        assert.equal(await stock(jugo), 10);
        assert.equal((await estadoPedido(r.body.id_pedido)).estado_pedido, 'Cancelado');

        assert.equal((await api('POST', `/pedidos/${r.body.id_pedido}/rechazar`,  { token: tCajero })).status, 409);
        assert.equal((await api('POST', `/pedidos/${r.body.id_pedido}/confirmar`, { token: tCajero })).status, 409);
        assert.equal(await stock(jugo), 10);
    });

    test('id inexistente o no numérico → 404', async () => {
        assert.equal((await api('POST', '/pedidos/999999/confirmar', { token: tCajero })).status, 404);
        assert.equal((await api('POST', '/pedidos/abc/confirmar',    { token: tCajero })).status, 404);
    });
});

// ─── Flujo completo hasta el cobro ───
describe('Menú QR: confirmar, entregar y cobrar', () => {
    let mesa, torta, cafe;

    before(async () => {
        mesa  = await crearMesa(30);
        torta = await crearProducto('Torta flujo', 20, 10);
        cafe  = await crearProducto('Café flujo', 5, 10);
    });

    test('flujo completo del cliente: pedir, confirmar, pedir más, entregar y pagar todo al final', async () => {
        // 1. Primer pedido
        const celular = 'd'.repeat(32);
        const p1 = await pedir(mesa.codigo_qr, [{ id_producto: torta, cantidad: 2, nota_cliente: 'en trozos' }],
                               { cliente_mesa: celular, nombre_cliente: '  Ana  ' });
        assert.equal(await stock(torta), 8);

        // 2. El cajero confirma: se abre la cuenta con los productos, sin descontar otra vez
        const conf = await api('POST', `/pedidos/${p1.body.id_pedido}/confirmar`, { token: tCajero });
        assert.equal(conf.status, 200);
        assert.equal(await stock(torta), 8);
        const id_cuenta = conf.body.id_cuenta;

        const items = await bd.sql(`SELECT * FROM detalle_cuenta WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(items.length, 1);
        assert.equal(items[0].origen, 'qr');
        assert.equal(items[0].nota, 'en trozos');
        assert.equal(items[0].cliente_mesa, celular);
        assert.equal(items[0].nombre_cliente, 'Ana');
        const [m] = await bd.sql(`SELECT estado_mesa FROM mesa_local WHERE id_mesa = $1`, [mesa.id_mesa]);
        assert.equal(m.estado_mesa, 'Ocupada');
        assert.equal((await api('POST', `/pedidos/${p1.body.id_pedido}/confirmar`, { token: tCajero })).status, 409);

        // 3. El cliente pide más: se suma a la misma cuenta
        const p2 = await pedir(mesa.codigo_qr, [{ id_producto: cafe, cantidad: 3 }], { cliente_mesa: celular });
        await api('POST', `/pedidos/${p2.body.id_pedido}/confirmar`, { token: tCajero });
        const [cuenta] = await bd.sql(`SELECT * FROM cuenta_mesa WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(Number(cuenta.total_acumulado), 55);
        assert.equal((await bd.sql(`SELECT 1 FROM cuenta_mesa WHERE id_mesa = $1 AND estado = 'Abierta'`, [mesa.id_mesa])).length, 1);

        // 4. El cliente ve sus pedidos y su consumo (por el código de su celular)
        const est = await api('GET', `/menu/m/${mesa.codigo_qr}/estado?cliente=${celular}`);
        assert.equal(est.status, 200);
        assert.deepEqual(est.body.pedidos.map(p => p.estado_pedido), ['Confirmado', 'Confirmado']);
        assert.equal(Number(est.body.cuenta.total_mesa), 55);
        assert.equal(Number(est.body.cuenta.mi_pendiente), 55);
        assert.equal(est.body.cuenta.items.length, 2);
        // Sin código no se ve nada
        assert.deepEqual((await api('GET', `/menu/m/${mesa.codigo_qr}/estado`)).body, { pedidos: [], cuenta: null });

        // 5. Entregado
        assert.equal((await api('POST', `/pedidos/${p1.body.id_pedido}/entregado`, { token: tCajero })).status, 200);
        assert.equal((await estadoPedido(p1.body.id_pedido)).estado_pedido, 'Entregado');
        assert.equal((await api('POST', `/pedidos/${p1.body.id_pedido}/entregado`, { token: tCajero })).status, 409);

        // 6. Se cobra todo al final: los pedidos quedan pagados y la venta lleva el total
        const cerrar = await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'Efectivo', id_sucursal: 1 } });
        assert.equal(cerrar.status, 200);
        const [venta] = await bd.sql(`SELECT monto_total_venta FROM venta_caja WHERE id_venta = $1`, [cerrar.body.id_venta]);
        assert.equal(Number(venta.monto_total_venta), 55);
        assert.equal((await estadoPedido(p1.body.id_pedido)).estado_pedido, 'Pagado');
        assert.equal((await estadoPedido(p2.body.id_pedido)).estado_pedido, 'Pagado');
        assert.equal(await stock(torta), 8);
        assert.equal(await stock(cafe), 7);

        const fin = await api('GET', `/menu/m/${mesa.codigo_qr}/estado?cliente=${celular}`);
        assert.equal(fin.body.cuenta, null);
    });

    test('pagar por separado: cada celular ve lo suyo y el cajero cobra cada parte', async () => {
        const mesaGrupo = await crearMesa(32);
        const [ana, beto] = ['1'.repeat(32), '2'.repeat(32)];
        const pa = await pedir(mesaGrupo.codigo_qr, [{ id_producto: torta, cantidad: 1 }], { cliente_mesa: ana, nombre_cliente: 'Ana' });
        const pb = await pedir(mesaGrupo.codigo_qr, [{ id_producto: cafe, cantidad: 2 }], { cliente_mesa: beto });
        const { id_cuenta } = (await api('POST', `/pedidos/${pa.body.id_pedido}/confirmar`, { token: tCajero })).body;
        await api('POST', `/pedidos/${pb.body.id_pedido}/confirmar`, { token: tCajero });
        // El cajero agrega algo para toda la mesa
        await api('POST', `/cuentas/${id_cuenta}/producto`, { token: tCajero, body: { id_producto: cafe, cantidad: 1 } });

        const verAna = (await api('GET', `/menu/m/${mesaGrupo.codigo_qr}/estado?cliente=${ana}`)).body;
        assert.deepEqual(verAna.pedidos.map(p => p.id_pedido), [pa.body.id_pedido]);
        assert.deepEqual(verAna.cuenta.items.map(i => i.nombre_producto), ['Torta flujo']);
        assert.equal(Number(verAna.cuenta.total_mesa), 35);

        // Beto no puede cancelar ni ver el pedido de Ana
        assert.equal((await api('POST', `/menu/m/${mesaGrupo.codigo_qr}/pedidos/${pa.body.id_pedido}/cancelar`,
                                { body: { cliente_mesa: beto } })).status, 404);

        // Cobro de la parte de Ana
        const cobroAna = await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'QR', cliente_mesa: ana } });
        assert.equal(cobroAna.status, 200);
        assert.equal(cobroAna.body.total, 20);
        assert.equal(cobroAna.body.cuenta_cerrada, false);
        assert.equal((await estadoPedido(pa.body.id_pedido)).estado_pedido, 'Pagado');
        assert.equal((await estadoPedido(pb.body.id_pedido)).estado_pedido, 'Confirmado');
        const cuenta = (await api('GET', `/cuentas/mesa/${mesaGrupo.id_mesa}`, { token: tCajero })).body.cuenta;
        assert.equal(Number(cuenta.total_acumulado), 15);
        assert.equal(cuenta.items.filter(i => i.pagado).length, 1);

        const anaDespues = (await api('GET', `/menu/m/${mesaGrupo.codigo_qr}/estado?cliente=${ana}`)).body.cuenta;
        assert.equal(Number(anaDespues.mi_pendiente), 0);
        assert.equal(Number(anaDespues.mi_pagado), 20);

        // Lo pagado no se puede quitar ni volver a cobrar
        const pagado = cuenta.items.find(i => i.pagado);
        assert.equal((await api('DELETE', `/cuentas/detalle/${pagado.id_detalle_cuenta}`, { token: tCajero })).status, 409);
        assert.equal((await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'QR', cliente_mesa: ana } })).status, 409);
        assert.equal((await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'QR', cliente_mesa: 'no-valido' } })).status, 400);

        // Lo cargado por el cajero (sin celular) y luego lo de Beto: con eso se cierra la mesa
        const cobroMesa = await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'Efectivo', cliente_mesa: null } });
        assert.equal(cobroMesa.body.total, 5);
        const cobroBeto = await api('POST', `/cuentas/${id_cuenta}/cerrar`,
            { token: tCajero, body: { metodo_pago: 'Efectivo', cliente_mesa: beto } });
        assert.equal(cobroBeto.body.total, 10);
        assert.equal(cobroBeto.body.cuenta_cerrada, true);
        assert.equal((await estadoPedido(pb.body.id_pedido)).estado_pedido, 'Pagado');

        const [cerrada] = await bd.sql(`SELECT estado, total_acumulado FROM cuenta_mesa WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(cerrada.estado, 'Pagada');
        assert.equal(Number(cerrada.total_acumulado), 35);
        const [m] = await bd.sql(`SELECT estado_mesa FROM mesa_local WHERE id_mesa = $1`, [mesaGrupo.id_mesa]);
        assert.equal(m.estado_mesa, 'Libre');
        const ventas = await bd.sql(`SELECT SUM(monto_total_venta)::float8 AS t, COUNT(*)::int AS n FROM venta_caja
                                     WHERE id_venta = ANY($1::int[])`,
                                    [[cobroAna.body.id_venta, cobroMesa.body.id_venta, cobroBeto.body.id_venta]]);
        assert.deepEqual(ventas[0], { t: 35, n: 3 });
    });

    test('el cliente puede cancelar su pedido solo antes de que lo confirmen, y solo desde su mesa', async () => {
        const otraMesa = await crearMesa(31);
        const celular = 'e'.repeat(32);
        const p = await pedir(mesa.codigo_qr, [{ id_producto: cafe, cantidad: 2 }], { cliente_mesa: celular });
        const antes = await stock(cafe);

        assert.equal((await api('POST', `/menu/m/${otraMesa.codigo_qr}/pedidos/${p.body.id_pedido}/cancelar`)).status, 404);
        // La otra mesa tampoco puede ver el pedido
        const ajeno = await api('GET', `/menu/m/${otraMesa.codigo_qr}/estado?cliente=${celular}`);
        assert.equal(ajeno.body.pedidos.length, 0);

        const c = await api('POST', `/menu/m/${mesa.codigo_qr}/pedidos/${p.body.id_pedido}/cancelar`,
                            { body: { cliente_mesa: celular } });
        assert.equal(c.status, 200);
        assert.equal(await stock(cafe), antes + 2);

        const p2 = await pedir(mesa.codigo_qr, [{ id_producto: cafe, cantidad: 1 }]);
        await api('POST', `/pedidos/${p2.body.id_pedido}/confirmar`, { token: tCajero });
        assert.equal((await api('POST', `/menu/m/${mesa.codigo_qr}/pedidos/${p2.body.id_pedido}/cancelar`)).status, 409);
    });

    test('resetear la mesa cancela sus pedidos (pendientes y confirmados) y devuelve todo el stock', async () => {
        const mesaR = await crearMesa(32);
        const prod  = await crearProducto('Reset QR', 3, 10);
        const pc = await pedir(mesaR.codigo_qr, [{ id_producto: prod, cantidad: 2 }]);
        await api('POST', `/pedidos/${pc.body.id_pedido}/confirmar`, { token: tCajero });
        const pp = await pedir(mesaR.codigo_qr, [{ id_producto: prod, cantidad: 3 }]);
        assert.equal(await stock(prod), 5);

        const r = await api('POST', '/cuentas/reset-mesa', { token: tAdmin, body: { id_mesa: mesaR.id_mesa } });
        assert.equal(r.status, 200);
        assert.equal(await stock(prod), 10);
        assert.equal((await estadoPedido(pc.body.id_pedido)).estado_pedido, 'Cancelado');
        assert.equal((await estadoPedido(pp.body.id_pedido)).estado_pedido, 'Cancelado');
    });

    test('eliminar una mesa con pedido pendiente devuelve el stock reservado', async () => {
        const mesaE = await crearMesa(33);
        const prod  = await crearProducto('Eliminar QR', 3, 10);
        await pedir(mesaE.codigo_qr, [{ id_producto: prod, cantidad: 4 }]);
        assert.equal(await stock(prod), 6);

        assert.equal((await api('DELETE', `/mesas/${mesaE.id_mesa}`, { token: tAdmin })).status, 200);
        assert.equal(await stock(prod), 10);
    });
});

// ─── Códigos QR ───
describe('Menú QR: códigos', () => {
    test('las mesas nuevas reciben un código aleatorio y el QR apunta a /menu/<codigo>', async () => {
        const r = await api('POST', '/mesas', { token: tCajero, body: { id_sucursal: 1, numero_mesa: 40 } });
        assert.equal(r.status, 201);
        assert.match(r.body.mesa.codigo_qr, /^[0-9a-f]{32}$/);

        const qr = await api('GET', `/mesas/${r.body.mesa.id_mesa}/qr?base_url=${encodeURIComponent('http://192.168.1.5:4200/x')}`,
                             { token: tCajero });
        assert.equal(qr.status, 200);
        assert.equal(qr.body.url, `http://192.168.1.5:4200/menu/${r.body.mesa.codigo_qr}`);
        assert.ok(qr.body.qr.startsWith('data:image/png'));

        const malo = await api('GET', `/mesas/${r.body.mesa.id_mesa}/qr?base_url=${encodeURIComponent('javascript:alert(1)')}`,
                               { token: tCajero });
        assert.equal(malo.status, 400);
    });

    test('regenerar el QR invalida el código anterior', async () => {
        const mesa = await crearMesa(41);
        const r = await api('POST', `/mesas/${mesa.id_mesa}/qr/regenerar`, { token: tCajero });
        assert.equal(r.status, 200);
        assert.equal((await api('GET', `/menu/m/${mesa.codigo_qr}`)).status, 404);
        const [nueva] = await bd.sql(`SELECT codigo_qr FROM mesa_local WHERE id_mesa = $1`, [mesa.id_mesa]);
        assert.equal((await api('GET', `/menu/m/${nueva.codigo_qr}`)).status, 200);
    });
});

// ─── Pedidos abandonados ───
describe('Menú QR: pedidos sin atender', () => {
    test('vencido el plazo se cancelan solos y devuelven el stock', async () => {
        const pedidoModel = require('../../src/models/pedidoModel');
        const mesa = await crearMesa(50);
        const prod = await crearProducto('Expira QR', 4, 10);
        const viejo  = await pedir(mesa.codigo_qr, [{ id_producto: prod, cantidad: 3 }]);
        const nuevo  = await pedir(mesa.codigo_qr, [{ id_producto: prod, cantidad: 2 }]);
        await bd.sql(`UPDATE pedido_mesa SET fecha_pedido = LOCALTIMESTAMP - interval '20 minutes' WHERE id_pedido = $1`,
                     [viejo.body.id_pedido]);
        assert.equal(await stock(prod), 5);

        const bandeja = await api('GET', '/pedidos/bandeja', { token: tCajero });
        assert.ok(bandeja.body.find(p => p.id_pedido === nuevo.body.id_pedido).fecha_expiracion);

        const r = await pedidoModel.expirarPendientes(15);
        assert.deepEqual(r.pedidos.map(p => p.id_pedido), [viejo.body.id_pedido]);
        assert.equal((await estadoPedido(viejo.body.id_pedido)).estado_pedido, 'Cancelado');
        assert.equal((await estadoPedido(nuevo.body.id_pedido)).estado_pedido, 'Pendiente_Cajero');
        assert.equal(await stock(prod), 8);
    });
});

// ─── Permisos de mesas, cuentas y cobro ───
describe('Permisos por módulo', () => {
    test('sin permiso de mesas no se usan cuentas ni mesas; sin punto_venta no se cobra', async () => {
        const id = await crearUsuario('sin.permisos@prueba.com', 2);
        await bd.sql(`INSERT INTO permiso_usuario (id_usuario, modulo, tiene_acceso)
                      VALUES ($1, 'mesas', FALSE), ($1, 'punto_venta', FALSE)`, [id]);
        const t = await login('sin.permisos@prueba.com');

        assert.equal((await api('GET',  '/cuentas/mesas/1',   { token: t })).status, 403);
        assert.equal((await api('POST', '/cuentas/abrir',     { token: t, body: { id_mesa: 1 } })).status, 403);
        assert.equal((await api('GET',  '/mesas/sucursal/1',  { token: t })).status, 403);
        assert.equal((await api('POST', '/mesas',             { token: t, body: { id_sucursal: 1, numero_mesa: 77 } })).status, 403);
        assert.equal((await api('POST', '/caja/cobrar',       { token: t, body: { id_sucursal: 1, metodo_pago: 'Efectivo', detalles: [] } })).status, 403);

        assert.equal((await api('GET', '/cuentas/mesas/1', { token: tCajero })).status, 200);
    });

    test('resetear una mesa es solo del administrador', async () => {
        const mesa = await crearMesa(60);
        assert.equal((await api('POST', '/cuentas/reset-mesa', { token: tCajero, body: { id_mesa: mesa.id_mesa } })).status, 403);
        assert.equal((await api('POST', '/cuentas/reset-mesa', { token: tAdmin,  body: { id_mesa: mesa.id_mesa } })).status, 200);
    });
});

// ─── Módulo de cocina eliminado ───
describe('Sin módulo de cocina', () => {
    test('no existe el rol Cocina ni las rutas /kds', async () => {
        assert.equal((await bd.sql(`SELECT 1 FROM rol_usuario WHERE nombre_rol = 'Cocina'`)).length, 0);
        assert.equal((await api('GET', '/kds', { token: tAdmin })).status, 404);
    });
});

// ─── Hoja de códigos QR ───
describe('Menú QR: códigos de todas las mesas', () => {
    test('una sola respuesta con los QR de la sucursal; el cajero solo ve la suya', async () => {
        await crearMesa(91);
        await crearMesa(92, 2);
        const base = 'http://192.168.1.10:4200';

        const propias = await api('GET', `/mesas/sucursal/1/qr?base_url=${encodeURIComponent(base)}`, { token: tCajero });
        assert.equal(propias.status, 200);
        const m31 = propias.body.find(m => m.numero_mesa === 91);
        assert.ok(m31.qr.startsWith('data:image/png;base64,'));
        assert.match(m31.url, /^http:\/\/192\.168\.1\.10:4200\/menu\/[0-9a-f]+$/);

        const ajena = await api('GET', `/mesas/sucursal/2/qr?base_url=${encodeURIComponent(base)}`, { token: tCajero });
        assert.ok(!ajena.body.some(m => m.numero_mesa === 92));
        const admin = await api('GET', `/mesas/sucursal/2/qr?base_url=${encodeURIComponent(base)}`, { token: tAdmin });
        assert.ok(admin.body.some(m => m.numero_mesa === 92));

        assert.equal((await api('GET', '/mesas/sucursal/1/qr?base_url=javascript:alert(1)', { token: tCajero })).status, 400);
    });
});
