const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin } = require('../sesionPrueba');
const { crearPedir } = require('../menuPrueba');

// ─── Lotes y PEPS: cada ingreso es un lote, las salidas sacan del más antiguo
//     y las devoluciones vuelven al mismo lote. La suma de los lotes siempre es el stock. ───

process.env.MENU_MAX_PEDIDOS_IP = '1000';

let bd, servidor, io, pool, URL_BASE, tAdmin, idOtra;
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
const pedir = () => crearPedir(api);

let numeroMesa = 200;
const nuevaMesa = async () => (await bd.sql(
    `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr) VALUES (1, $1, md5(random()::text)) RETURNING *`,
    [numeroMesa++]))[0];

/** Producto sin stock; tipo ELABORADO, PREPARADO o COMPRADO */
const crearProducto = async (nombre, tipo = 'ELABORADO') => {
    const [p] = await bd.sql(
        `INSERT INTO producto (id_categoria, nombre_producto, precio_unitario, tipo_producto)
         VALUES ((SELECT min(id_categoria) FROM categoria_producto), $1, 10, $2) RETURNING id_producto`, [nombre, tipo]);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, 0)`, [p.id_producto]);
    return p.id_producto;
};

const ingresar = (id_producto, cantidad, extra = {}) => api('POST', '/inventario/movimientos', {
    token: tAdmin, body: { id_producto, id_sucursal: 1, tipo: 'INGRESO', cantidad, motivo: 'Producción', ...extra }
});

/** Lotes del producto en la sucursal, del más antiguo al más nuevo */
const lotes = async (id_producto, id_sucursal = 1) => (await bd.sql(`
    SELECT l.id_lote, l.cantidad_actual, l.cantidad_inicial, l.fecha_ingreso, l.fecha_vencimiento
    FROM lote_inventario l JOIN inventario_sucursal i ON i.id_inventario = l.id_inventario
    WHERE i.id_producto = $1 AND i.id_sucursal = $2 ORDER BY l.fecha_ingreso, l.id_lote`, [id_producto, id_sucursal]));

const enLotes = async (id_producto, id_sucursal) => (await lotes(id_producto, id_sucursal)).map(l => l.cantidad_actual);

const stock = async (id_producto, id_sucursal = 1) => Number((await bd.sql(
    `SELECT cantidad_actual FROM inventario_sucursal WHERE id_producto = $1 AND id_sucursal = $2`,
    [id_producto, id_sucursal]))[0]?.cantidad_actual ?? 0);

/** La regla de oro: en toda la BD, la suma de los lotes es el stock (lo preparado no tiene lotes) */
const cuadraTodo = async () => {
    const malos = await bd.sql(`
        SELECT i.id_inventario, i.cantidad_actual, COALESCE(SUM(l.cantidad_actual), 0)::int AS en_lotes
        FROM inventario_sucursal i JOIN producto p ON p.id_producto = i.id_producto
        LEFT JOIN lote_inventario l ON l.id_inventario = i.id_inventario
        WHERE p.tipo_producto <> 'PREPARADO'
        GROUP BY i.id_inventario HAVING i.cantidad_actual <> COALESCE(SUM(l.cantidad_actual), 0)`);
    assert.deepEqual(malos, [], 'lotes y stock deben coincidir');
};

const cobrar = (detalles) => api('POST', '/caja/cobrar', {
    token: tAdmin, body: { id_sucursal: 1, metodo_pago: 'Efectivo', detalles }
});

/** Dos ingresos separados en el tiempo: lote viejo y lote nuevo */
const conDosLotes = async (nombre, viejo, nuevo) => {
    const id = await crearProducto(nombre);
    assert.equal((await ingresar(id, viejo)).status, 201);
    await bd.sql(`UPDATE lote_inventario l SET fecha_ingreso = fecha_ingreso - interval '1 day'
                  FROM inventario_sucursal i WHERE i.id_inventario = l.id_inventario AND i.id_producto = $1`, [id]);
    assert.equal((await ingresar(id, nuevo)).status, 201);
    return id;
};

before(async () => {
    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idOtra }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Destino') RETURNING id_sucursal`);

    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    const turno = await api('POST', '/caja/turnos/abrir', { token: tAdmin, body: { id_sucursal: 1, monto_inicial: 100 } });
    assert.equal(turno.status, 201);
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Lotes: ingresos y PEPS', () => {
    test('cada ingreso crea un lote que vence según la vida útil (48 h por defecto)', async () => {
        const id = await crearProducto('Lote nuevo');
        await ingresar(id, 12);
        const [l] = await lotes(id);
        assert.equal(l.cantidad_inicial, 12);
        const horas = (new Date(l.fecha_vencimiento) - new Date(l.fecha_ingreso)) / 3_600_000;
        assert.equal(Math.round(horas), 48);

        await bd.sql(`UPDATE producto SET vida_util_horas = 6 WHERE id_producto = $1`, [id]);
        await ingresar(id, 3);
        const ultimo = (await lotes(id)).at(-1);
        assert.equal(Math.round((new Date(ultimo.fecha_vencimiento) - new Date(ultimo.fecha_ingreso)) / 3_600_000), 6);
        await cuadraTodo();
    });

    test('la venta sale primero del lote más antiguo', async () => {
        const id = await conDosLotes('Peps venta', 5, 5);
        const r = await cobrar([{ id_producto: id, cantidad: 7 }]);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual(await enLotes(id), [0, 3]);
        assert.equal(await stock(id), 3);
        await cuadraTodo();
    });

    test('compra a proveedor con la fecha del envase', async () => {
        const id = await crearProducto('Refresco envase', 'COMPRADO');
        const r = await ingresar(id, 24, { motivo: 'Compra a proveedor', fecha_vencimiento: '2099-03-15' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const [l] = await lotes(id);
        assert.equal(l.fecha_vencimiento.toLocaleDateString('en-CA'), '2099-03-15');
        assert.equal((await ingresar(id, 1, { fecha_vencimiento: '2020-01-01' })).status, 400, 'fecha pasada');
        assert.equal((await ingresar(id, 1, { fecha_vencimiento: 'mañana' })).status, 400);
    });

    test('un lote vencido NO se bloquea: el cajero decide si lo vende', async () => {
        const id = await crearProducto('Vencido vendible');
        await ingresar(id, 4);
        await bd.sql(`UPDATE lote_inventario l SET fecha_vencimiento = now() - interval '1 hour'
                      FROM inventario_sucursal i WHERE i.id_inventario = l.id_inventario AND i.id_producto = $1`, [id]);
        assert.equal((await cobrar([{ id_producto: id, cantidad: 1 }])).status, 201);
        assert.deepEqual(await enLotes(id), [3]);
    });
});

describe('Lotes: devoluciones vuelven a su lote', () => {
    test('quitar un producto de la mesa lo devuelve a los lotes de los que salió', async () => {
        const id = await conDosLotes('Mesa devuelve', 3, 5);
        const mesa = await nuevaMesa();
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tAdmin, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        const ag = await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tAdmin, body: { id_producto: id, cantidad: 4 } });
        assert.equal(ag.status, 201, JSON.stringify(ag.body));
        assert.deepEqual(await enLotes(id), [0, 4]);

        // tomó 3 del viejo y 1 del nuevo; al bajar a 2 vuelve primero al más nuevo: 1 a cada uno
        assert.equal((await api('PATCH', `/cuentas/detalle/${ag.body.detalle.id_detalle_cuenta}`, { token: tAdmin, body: { cantidad: 2 } })).status, 200);
        assert.deepEqual(await enLotes(id), [1, 5]);
        assert.equal((await api('DELETE', `/cuentas/detalle/${ag.body.detalle.id_detalle_cuenta}`, { token: tAdmin })).status, 200);
        assert.deepEqual(await enLotes(id), [3, 5], 'cada unidad vuelve a su lote');
        await cuadraTodo();
    });

    test('rechazar un pedido QR devuelve a los mismos lotes', async () => {
        const id = await conDosLotes('QR rechazo', 2, 6);
        const mesa = await nuevaMesa();
        const ped = await pedir()(mesa.codigo_qr, [{ id_producto: id, cantidad: 3 }]);
        assert.equal(ped.status, 201, JSON.stringify(ped.body));
        assert.deepEqual(await enLotes(id), [0, 5]);
        assert.equal((await api('POST', `/pedidos/${ped.body.id_pedido}/rechazar`, { token: tAdmin })).status, 200);
        assert.deepEqual(await enLotes(id), [2, 6]);
        await cuadraTodo();
    });

    test('un pedido QR confirmado y quitado de la cuenta vuelve a los lotes del pedido', async () => {
        const id = await conDosLotes('QR confirmado', 1, 4);
        const mesa = await nuevaMesa();
        const ped = await pedir()(mesa.codigo_qr, [{ id_producto: id, cantidad: 2 }]);
        assert.equal(ped.status, 201, JSON.stringify(ped.body));
        assert.equal((await api('POST', `/pedidos/${ped.body.id_pedido}/confirmar`, { token: tAdmin })).status, 200);
        assert.deepEqual(await enLotes(id), [0, 3]);
        const [linea] = await bd.sql(`SELECT id_detalle_cuenta FROM detalle_cuenta WHERE id_pedido = $1`, [ped.body.id_pedido]);
        assert.equal((await api('DELETE', `/cuentas/detalle/${linea.id_detalle_cuenta}`, { token: tAdmin })).status, 200);
        assert.deepEqual(await enLotes(id), [1, 4]);
        await cuadraTodo();
    });
});

describe('Lotes: transferencias', () => {
    test('el destino recibe los mismos lotes (fecha y vencimiento) y el origen sale por PEPS', async () => {
        const id = await conDosLotes('Transferido', 2, 5);
        const origen = await lotes(id);
        const r = await api('POST', '/inventario/transferencias', {
            token: tAdmin, body: { id_sucursal_origen: 1, id_sucursal_destino: idOtra, items: [{ id_producto: id, cantidad: 4 }] }
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.deepEqual(await enLotes(id), [0, 3]);
        const destino = await lotes(id, idOtra);
        assert.deepEqual(destino.map(l => l.cantidad_actual), [2, 2]);
        assert.equal(destino[0].fecha_vencimiento.getTime(), origen[0].fecha_vencimiento.getTime());
        assert.equal(destino[1].fecha_ingreso.getTime(), origen[1].fecha_ingreso.getTime());
        await cuadraTodo();
    });
});

describe('Lotes: preparado al momento', () => {
    test('se vende sin stock ni lotes y no se mueve ni se transfiere', async () => {
        const id = await crearProducto('Te de prueba', 'PREPARADO');
        const lista = (await api('GET', '/catalogo/productos?id_sucursal=1', { token: tAdmin })).body;
        const te = lista.find(p => p.id_producto === id);
        assert.equal(te.tipo_producto, 'PREPARADO');
        assert.ok(te.stock_actual > 1000, 'siempre disponible');

        assert.equal((await cobrar([{ id_producto: id, cantidad: 3 }])).status, 201);
        assert.equal(await stock(id), 0);
        assert.equal((await lotes(id)).length, 0);
        const [{ n }] = await bd.sql(`SELECT count(*)::int AS n FROM historial_inventario h JOIN inventario_sucursal i USING (id_inventario) WHERE i.id_producto = $1`, [id]);
        assert.equal(n, 0, 'no deja movimientos de stock');

        assert.equal((await ingresar(id, 5)).status, 409);
        const tr = await api('POST', '/inventario/transferencias', {
            token: tAdmin, body: { id_sucursal_origen: 1, id_sucursal_destino: idOtra, items: [{ id_producto: id, cantidad: 1 }] }
        });
        assert.equal(tr.status, 400);

        const mesa = await nuevaMesa();
        const ped = await pedir()(mesa.codigo_qr, [{ id_producto: id, cantidad: 2 }]);
        assert.equal(ped.status, 201, JSON.stringify(ped.body));
    });

    test('al pasar un producto a preparado su stock sale (Ajuste de conteo)', async () => {
        const id = await crearProducto('Pasa a preparado');
        await ingresar(id, 7);
        const r = await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { tipo_producto: 'PREPARADO' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(await stock(id), 0);
        assert.deepEqual(await enLotes(id), [0]);
        assert.equal((await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { tipo_producto: 'OTRO' } })).status, 400);
    });
});

describe('Lotes: robustez', () => {
    test('si alguien cambia el stock a mano en la BD, los lotes se corrigen solos sin frenar la venta', async () => {
        const id = await crearProducto('Tocado a mano');
        await ingresar(id, 3);
        await bd.sql(`UPDATE inventario_sucursal SET cantidad_actual = 10 WHERE id_producto = $1 AND id_sucursal = 1`, [id]);
        assert.equal((await cobrar([{ id_producto: id, cantidad: 2 }])).status, 201);
        assert.equal(await stock(id), 8);
        await cuadraTodo();

        await bd.sql(`UPDATE inventario_sucursal SET cantidad_actual = 1 WHERE id_producto = $1 AND id_sucursal = 1`, [id]);
        assert.equal((await cobrar([{ id_producto: id, cantidad: 1 }])).status, 201);
        assert.equal(await stock(id), 0);
        await cuadraTodo();
    });

    test('la revisión del cierre del día corrige todo lo descuadrado', async () => {
        const id = await crearProducto('Revision diaria');
        await ingresar(id, 5);
        await bd.sql(`UPDATE inventario_sucursal SET cantidad_actual = 9 WHERE id_producto = $1 AND id_sucursal = 1`, [id]);
        const corregidos = await require('../../src/models/loteModel').cuadrarTodos(pool);
        assert.ok(corregidos >= 1);
        await cuadraTodo();
    });

    test('ventas a la vez del último stock: una sola gana y ningún lote queda negativo', async () => {
        const id = await conDosLotes('Ultimas', 1, 2);
        const r = await Promise.all(Array.from({ length: 5 }, () => cobrar([{ id_producto: id, cantidad: 2 }])));
        assert.equal(r.filter(x => x.status === 201).length, 1);
        assert.equal(await stock(id), 1);
        assert.deepEqual(await enLotes(id), [0, 1]);
        await cuadraTodo();
    });

    test('la BD no acepta lotes negativos ni más de lo que entró', async () => {
        const id = await crearProducto('Restricciones');
        await ingresar(id, 2);
        const [l] = await lotes(id);
        await assert.rejects(bd.sql(`UPDATE lote_inventario SET cantidad_actual = -1 WHERE id_lote = $1`, [l.id_lote]));
        await assert.rejects(bd.sql(`UPDATE lote_inventario SET cantidad_actual = 3 WHERE id_lote = $1`, [l.id_lote]));
    });
});

describe('Vencidos', () => {
    /** Fija el vencimiento del lote (horas desde ahora; negativo = ya venció) */
    const vencerEn = (id_lote, horas) => bd.sql(
        `UPDATE lote_inventario SET fecha_vencimiento = LOCALTIMESTAMP + make_interval(hours => $2) WHERE id_lote = $1`, [id_lote, horas]);

    /** Producto con tres lotes: vencido (2), por vencer en 3 h (4) y vigente (6) */
    const conTresEstados = async (nombre) => {
        const id = await crearProducto(nombre);
        for (const n of [2, 4, 6]) await ingresar(id, n);
        const [a, b, c] = await lotes(id);
        await vencerEn(a.id_lote, -1);
        await vencerEn(b.id_lote, 3);
        await vencerEn(c.id_lote, 40);
        return { id, vencido: a.id_lote, porVencer: b.id_lote, vigente: c.id_lote };
    };

    test('la lista de Inventario trae cuántas unidades están vencidas y por vencer', async () => {
        const { id } = await conTresEstados('Estados lista');
        const p = (await api('GET', '/catalogo/productos?id_sucursal=1', { token: tAdmin })).body.find(x => x.id_producto === id);
        assert.equal(p.vencidos, 2);
        assert.equal(p.por_vencer, 4);
        assert.equal(p.stock_actual, 12);
    });

    test('vencimientos de la sucursal: vencidos y por vencer, sin los vigentes', async () => {
        const { id, vencido, porVencer } = await conTresEstados('Estados vencimientos');
        const r = await api('GET', '/inventario/vencimientos?id_sucursal=1', { token: tAdmin });
        assert.equal(r.status, 200);
        const mios = r.body.filter(l => l.id_producto === id);
        assert.deepEqual(mios.map(l => [l.id_lote, l.estado, l.cantidad]), [[vencido, 'VENCIDO', 2], [porVencer, 'POR_VENCER', 4]]);
    });

    test('el aviso de por vencer es configurable', async () => {
        const { id } = await conTresEstados('Aviso configurable');
        const cambio = await api('PUT', '/ajustes/parametros', { token: tAdmin, body: { aviso_vence_elaborado_horas: 48 } });
        assert.equal(cambio.status, 200, JSON.stringify(cambio.body));
        const p = (await api('GET', '/catalogo/productos?id_sucursal=1', { token: tAdmin })).body.find(x => x.id_producto === id);
        assert.equal(p.por_vencer, 10, 'con 48 h de aviso el lote de 40 h también está por vencer');
        assert.equal((await api('PUT', '/ajustes/parametros', { token: tAdmin, body: { aviso_vence_elaborado_horas: 0 } })).status, 400);
        await api('PUT', '/ajustes/parametros', { token: tAdmin, body: { aviso_vence_elaborado_horas: 12 } });
    });

    test('un aviso por sucursal y estado, una sola vez por lote', async () => {
        const nombre = 'AVISO UNICO';
        await conTresEstados(nombre);
        const { vencimientos } = require('../../src/models/notificacionModel');
        await vencimientos();
        const avisos = async () => (await bd.sql(`SELECT tipo FROM notificacion WHERE mensaje LIKE $1 ORDER BY tipo`, [`%${nombre}%`]))
            .map(n => n.tipo);
        assert.deepEqual(await avisos(), ['POR_VENCER', 'VENCIDO']);
        await vencimientos();
        assert.deepEqual(await avisos(), ['POR_VENCER', 'VENCIDO'], 'no se repite');
    });

    test('«Dar de baja vencidos» saca solo los lotes vencidos, como merma «Vencido»', async () => {
        const { id, vencido, porVencer } = await conTresEstados('Baja vencidos');
        const r = await api('POST', '/inventario/vencidos/baja', { token: tAdmin, body: { id_sucursal: 1, lotes: [vencido, porVencer] } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body, { lotes: 1, unidades: 2 }, 'el lote por vencer no se toca');
        assert.deepEqual(await enLotes(id), [0, 4, 6]);
        assert.equal(await stock(id), 10);
        const [h] = await bd.sql(`
            SELECT h.motivo_movimiento, h.cantidad_movida, h.detalle FROM historial_inventario h
            JOIN inventario_sucursal i USING (id_inventario) WHERE i.id_producto = $1 AND h.tipo_movimiento = 'SALIDA'`, [id]);
        assert.equal(h.motivo_movimiento, 'Vencido');
        assert.equal(h.cantidad_movida, 2);
        assert.match(h.detalle, new RegExp(`LOTE #${vencido}`));
        await cuadraTodo();

        // Otra vez: ya no queda nada que dar de baja
        assert.deepEqual((await api('POST', '/inventario/vencidos/baja', { token: tAdmin, body: { lotes: [vencido] } })).body,
                         { lotes: 0, unidades: 0 });
        assert.equal((await api('POST', '/inventario/vencidos/baja', { token: tAdmin, body: { lotes: [] } })).status, 400);
    });

    test('si se vendió parte del lote vencido, la baja saca solo lo que queda', async () => {
        const { id, vencido } = await conTresEstados('Vendido antes de la baja');
        assert.equal((await cobrar([{ id_producto: id, cantidad: 1 }])).status, 201, 'un vencido se puede vender');
        const r = await api('POST', '/inventario/vencidos/baja', { token: tAdmin, body: { lotes: [vencido] } });
        assert.deepEqual(r.body, { lotes: 1, unidades: 1 });
        assert.deepEqual(await enLotes(id), [0, 4, 6]);
        await cuadraTodo();
    });
});
