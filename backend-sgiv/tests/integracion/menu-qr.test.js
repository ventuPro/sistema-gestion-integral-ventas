const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');

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
    return { status: r.status, body: datos };
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
        const p1 = await pedir(mesa.codigo_qr, [{ id_producto: torta, cantidad: 2, nota_cliente: 'en trozos' }]);
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
        const [m] = await bd.sql(`SELECT estado_mesa FROM mesa_local WHERE id_mesa = $1`, [mesa.id_mesa]);
        assert.equal(m.estado_mesa, 'Ocupada');
        assert.equal((await api('POST', `/pedidos/${p1.body.id_pedido}/confirmar`, { token: tCajero })).status, 409);

        // 3. El cliente pide más: se suma a la misma cuenta
        const p2 = await pedir(mesa.codigo_qr, [{ id_producto: cafe, cantidad: 3 }]);
        await api('POST', `/pedidos/${p2.body.id_pedido}/confirmar`, { token: tCajero });
        const [cuenta] = await bd.sql(`SELECT * FROM cuenta_mesa WHERE id_cuenta = $1`, [id_cuenta]);
        assert.equal(Number(cuenta.total_acumulado), 55);
        assert.equal((await bd.sql(`SELECT 1 FROM cuenta_mesa WHERE id_mesa = $1 AND estado = 'Abierta'`, [mesa.id_mesa])).length, 1);

        // 4. El cliente ve sus pedidos y el consumo de la mesa
        const est = await api('GET', `/menu/m/${mesa.codigo_qr}/estado?ids=${p1.body.id_pedido},${p2.body.id_pedido}`);
        assert.equal(est.status, 200);
        assert.deepEqual(est.body.pedidos.map(p => p.estado_pedido), ['Confirmado', 'Confirmado']);
        assert.equal(Number(est.body.cuenta.total_acumulado), 55);
        assert.equal(est.body.cuenta.items.length, 2);

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

        const fin = await api('GET', `/menu/m/${mesa.codigo_qr}/estado?ids=${p1.body.id_pedido}`);
        assert.equal(fin.body.cuenta, null);
    });

    test('el cliente puede cancelar su pedido solo antes de que lo confirmen, y solo desde su mesa', async () => {
        const otraMesa = await crearMesa(31);
        const p = await pedir(mesa.codigo_qr, [{ id_producto: cafe, cantidad: 2 }]);
        const antes = await stock(cafe);

        assert.equal((await api('POST', `/menu/m/${otraMesa.codigo_qr}/pedidos/${p.body.id_pedido}/cancelar`)).status, 404);
        // La otra mesa tampoco puede ver el pedido
        const ajeno = await api('GET', `/menu/m/${otraMesa.codigo_qr}/estado?ids=${p.body.id_pedido}`);
        assert.equal(ajeno.body.pedidos.length, 0);

        const c = await api('POST', `/menu/m/${mesa.codigo_qr}/pedidos/${p.body.id_pedido}/cancelar`);
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

// ─── Módulo de cocina eliminado ───
describe('Sin módulo de cocina', () => {
    test('no existe el rol Cocina ni las rutas /kds', async () => {
        assert.equal((await bd.sql(`SELECT 1 FROM rol_usuario WHERE nombre_rol = 'Cocina'`)).length, 0);
        assert.equal((await api('GET', '/kds', { token: tAdmin })).status, 404);
    });
});
