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
    SELECT l.id_lote, l.cantidad_actual, l.cantidad_inicial, l.fecha_ingreso, l.fecha_vencimiento, l.costo_unitario
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

describe('Costos por lote y costo de lo vendido', () => {
    /** Receta simple: inversión ÷ rendimiento = costo por unidad */
    const receta = (id_producto, inversion, rendimiento = 10) => bd.sql(`
        INSERT INTO receta (nombre, rendimiento, inversion, id_producto) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_producto) WHERE id_producto IS NOT NULL DO UPDATE SET inversion = EXCLUDED.inversion, rendimiento = EXCLUDED.rendimiento`,
        [`RECETA ${id_producto}`, rendimiento, inversion, id_producto]);
    const costos = async (id) => (await lotes(id)).map(l => l.costo_unitario == null ? null : Number(l.costo_unitario));
    const costoVendido = async (id_venta, id_producto) => {
        const [d] = await bd.sql(`SELECT costo_unitario FROM detalle_venta WHERE id_venta = $1 AND id_producto = $2`, [id_venta, id_producto]);
        return d.costo_unitario == null ? null : Number(d.costo_unitario);
    };

    test('lo elaborado entra con el costo de su receta de ese día; si la receta cambia, los lotes viejos no', async () => {
        const id = await crearProducto('Costo receta');
        await receta(id, 25);                                    // 2,50 por unidad
        await ingresar(id, 10);
        await receta(id, 40);                                    // ahora 4,00
        await ingresar(id, 5);
        assert.deepEqual(await costos(id), [2.5, 4]);

        // PEPS: 10 a 2,50 y 2 a 4,00 → 2,75 por unidad
        const r = await cobrar([{ id_producto: id, cantidad: 12 }]);
        assert.equal(r.status, 201);
        assert.equal(await costoVendido(r.body.id_venta, id), 2.75);
    });

    test('sin receta el lote queda sin costo y la venta también', async () => {
        const id = await crearProducto('Sin receta');
        await ingresar(id, 3);
        assert.deepEqual(await costos(id), [null]);
        const r = await cobrar([{ id_producto: id, cantidad: 1 }]);
        assert.equal(await costoVendido(r.body.id_venta, id), null);
    });

    test('lo comprado: el administrador pone el costo y la compra siguiente lo sugiere', async () => {
        const id = await crearProducto('Costo compra', 'COMPRADO');
        assert.equal((await ingresar(id, 6, { motivo: 'Compra a proveedor', costo_unitario: 3.2 })).status, 201);
        assert.equal((await api('GET', `/inventario/costo?id_producto=${id}`, { token: tAdmin })).body.costo, 3.2);
        await ingresar(id, 4, { motivo: 'Compra a proveedor' });
        assert.deepEqual(await costos(id), [3.2, 3.2]);
        assert.equal((await ingresar(id, 1, { costo_unitario: -1 })).status, 400);
    });

    test('lo preparado cuesta lo de su receta al venderlo', async () => {
        const id = await crearProducto('Te con receta', 'PREPARADO');
        await receta(id, 3.1, 10);                               // 0,31 la taza
        const r = await cobrar([{ id_producto: id, cantidad: 2 }]);
        assert.equal(await costoVendido(r.body.id_venta, id), 0.31);
    });

    test('al cobrar una mesa, el costo es el de los lotes que reservó (también lo del menú QR)', async () => {
        const id = await crearProducto('Costo mesa');
        await receta(id, 20);                                    // 2,00
        await ingresar(id, 3);
        await bd.sql(`UPDATE lote_inventario l SET fecha_ingreso = fecha_ingreso - interval '1 day'
                      FROM inventario_sucursal i WHERE i.id_inventario = l.id_inventario AND i.id_producto = $1`, [id]);
        await receta(id, 50);                                    // 5,00
        await ingresar(id, 5);

        const mesa = await nuevaMesa();
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tAdmin, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tAdmin, body: { id_producto: id, cantidad: 2 } });   // 2 a 2,00
        const ped = await pedir()(mesa.codigo_qr, [{ id_producto: id, cantidad: 2 }]);                                          // 1 a 2,00 y 1 a 5,00
        assert.equal(ped.status, 201, JSON.stringify(ped.body));
        assert.equal((await api('POST', `/pedidos/${ped.body.id_pedido}/confirmar`, { token: tAdmin })).status, 200);

        const r = await api('POST', `/cuentas/${cuenta.id_cuenta}/cerrar`, { token: tAdmin, body: { metodo_pago: 'Efectivo' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        // Cada línea con su costo: la del cajero 2 × 2,00 y la del pedido QR 1 × 2,00 + 1 × 5,00
        const lineas = await bd.sql(`
            SELECT dv.costo_unitario::float8 AS costo, dv.cantidad_vendida AS cantidad FROM detalle_venta dv
            WHERE dv.id_venta = (SELECT DISTINCT id_venta FROM detalle_cuenta WHERE id_cuenta = $1) AND dv.id_producto = $2
            ORDER BY dv.id_detalle_venta`, [cuenta.id_cuenta, id]);
        assert.deepEqual(lineas.map(l => [l.cantidad, l.costo]), [[2, 2], [2, 3.5]]);
    });

    test('la transferencia lleva el costo de cada lote', async () => {
        const id = await crearProducto('Costo transferido');
        await receta(id, 30);
        await ingresar(id, 4);
        await receta(id, 60);                                    // la receta cambia en el destino: no importa
        const r = await api('POST', '/inventario/transferencias', {
            token: tAdmin, body: { id_sucursal_origen: 1, id_sucursal_destino: idOtra, items: [{ id_producto: id, cantidad: 2 }] }
        });
        assert.equal(r.status, 201);
        const destino = await lotes(id, idOtra);
        assert.equal(Number(destino[0].costo_unitario), 3);
    });

    test('el informe del administrador trae el costo de lo vendido y la ganancia', async () => {
        const id = await crearProducto('Costo informe');
        await receta(id, 40);                                    // 4,00; se vende a 10
        await ingresar(id, 5);
        await cobrar([{ id_producto: id, cantidad: 3 }]);
        const [{ hoy }] = await bd.sql(`SELECT to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') AS hoy`);
        const inf = await api('GET', `/reportes/periodo/1?fecha_inicio=${hoy}&fecha_fin=${hoy}`, { token: tAdmin });
        assert.equal(inf.status, 200, JSON.stringify(inf.body));
        const p = inf.body.costos.productos.find(x => x.id_producto === id);
        assert.deepEqual([p.unidades, p.ingresos, p.costo, p.ganancia, p.margen], [3, 30, 12, 18, 60]);
        assert.ok(inf.body.costos.resumen.ganancia > 0);
    });
});

describe('Inventario valorado y kardex', () => {
    const receta = (id_producto, inversion, rendimiento = 10) => bd.sql(`
        INSERT INTO receta (nombre, rendimiento, inversion, id_producto) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_producto) WHERE id_producto IS NOT NULL DO UPDATE SET inversion = EXCLUDED.inversion`,
        [`RECETA VALOR ${id_producto}`, rendimiento, inversion, id_producto]);
    const dia = async (desplazamiento = 0) => (await bd.sql(
        `SELECT to_char((now() AT TIME ZONE 'America/La_Paz')::date + $1::int, 'YYYY-MM-DD') AS d`, [desplazamiento]))[0].d;
    const valorado = async (fecha) => (await api('GET', `/reportes/inventario-valorado/1${fecha ? `?fecha=${fecha}` : ''}`, { token: tAdmin })).body;
    const fila = (v, id) => v.categorias.flatMap(c => c.productos).find(p => p.id_producto === id);
    const kardex = async (id, desde, hasta) =>
        (await api('GET', `/reportes/kardex/1?id_producto=${id}&fecha_inicio=${desde}&fecha_fin=${hasta}`, { token: tAdmin })).body;

    /** Pasa todo lo registrado del producto n días atrás (lotes e historial) */
    const atrasar = (id, dias) => bd.sql(`
        WITH i AS (SELECT id_inventario FROM inventario_sucursal WHERE id_producto = $1),
             l AS (UPDATE lote_inventario SET fecha_ingreso = fecha_ingreso - make_interval(days => $2)
                   WHERE id_inventario IN (SELECT id_inventario FROM i))
        UPDATE historial_inventario SET fecha_registro = fecha_registro - make_interval(days => $2)
        WHERE id_inventario IN (SELECT id_inventario FROM i)`, [id, dias]);

    test('valor al costo (PEPS) y a precio de venta, con la ganancia esperada', async () => {
        const id = await crearProducto('Valorado hoy');           // precio 10
        await receta(id, 25);                                       // 2,50
        await ingresar(id, 10);
        await receta(id, 40);                                       // 4,00
        await ingresar(id, 5);
        const p = fila(await valorado(), id);
        assert.deepEqual([p.cantidad, p.valor_costo, p.valor_venta, p.ganancia, p.costo_promedio], [15, 45, 150, 105, 3]);
        assert.deepEqual(p.lotes.map(l => [l.cantidad, l.costo_unitario]), [[10, 2.5], [5, 4]]);
    });

    test('lo sin costo se cuenta aparte y no infla el valor', async () => {
        const id = await crearProducto('Valorado sin costo');
        await ingresar(id, 4);
        const p = fila(await valorado(), id);
        assert.deepEqual([p.cantidad, p.sin_costo, p.valor_costo, p.ganancia], [4, 4, 0, 0]);
    });

    test('con fecha de corte pasada se ve lo que había ese día; el kardex cuadra con el stock y los lotes', async () => {
        const id = await crearProducto('Kardex completo');
        await receta(id, 20);                                       // 2,00
        await ingresar(id, 10);
        await atrasar(id, 3);                                       // entró hace 3 días
        assert.equal((await cobrar([{ id_producto: id, cantidad: 4 }])).status, 201);
        await api('POST', '/inventario/movimientos', {
            token: tAdmin, body: { id_producto: id, id_sucursal: 1, tipo: 'SALIDA', cantidad: 1, motivo: 'Dañado' } });

        assert.equal(fila(await valorado(await dia(-2)), id).cantidad, 10, 'antes de la venta');
        assert.equal(fila(await valorado(), id).cantidad, 5);
        assert.equal((await api('GET', `/reportes/inventario-valorado/1?fecha=${await dia(1)}`, { token: tAdmin })).status, 400);

        const k = await kardex(id, await dia(-5), await dia(0));
        assert.deepEqual(k.inicial, { cantidad: 0, valor: 0 });
        assert.deepEqual(k.movimientos.map(m => [m.tipo, m.cantidad, m.costo_unitario, m.total, m.saldo.cantidad, m.saldo.valor]), [
            ['INGRESO', 10, 2, 20, 10, 20],
            ['SALIDA',  4,  2, 8,  6,  12],
            ['SALIDA',  1,  2, 2,  5,  10]
        ]);
        assert.deepEqual([k.totales.entradas, k.totales.valor_entradas, k.totales.salidas, k.totales.valor_salidas], [10, 20, 5, 10]);
        assert.equal(k.final.cantidad, await stock(id));
        const [{ valor }] = await bd.sql(`
            SELECT SUM(l.cantidad_actual * l.costo_unitario)::float8 AS valor FROM lote_inventario l
            JOIN inventario_sucursal i USING (id_inventario) WHERE i.id_producto = $1`, [id]);
        assert.equal(k.final.valor, valor);

        // Desde ayer: el saldo inicial ya trae lo que entró hace 3 días
        const ayer = await kardex(id, await dia(-1), await dia(0));
        assert.deepEqual(ayer.inicial, { cantidad: 10, valor: 20 });
        assert.equal(ayer.movimientos.length, 2);
    });

    test('kardex: pide producto y fechas válidas', async () => {
        assert.equal((await api('GET', `/reportes/kardex/1?fecha_inicio=2026-01-01&fecha_fin=2026-01-02`, { token: tAdmin })).status, 400);
        const id = await crearProducto('Kardex fechas');
        assert.equal((await api('GET', `/reportes/kardex/1?id_producto=${id}&fecha_inicio=2026-02-01&fecha_fin=2026-01-01`, { token: tAdmin })).status, 400);
    });
});

describe('Inventario valorado y kardex: solo el administrador', () => {
    test('un cajero con permiso de Reportes no los ve', async () => {
        const hash = await bcrypt.hash(CLAVE, 4);
        const [u] = await bd.sql(`
            INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
            VALUES (1, 2, 'Cajero Reportes', 'cajero.reportes@prueba.com', $1) RETURNING id_usuario`, [hash]);
        assert.equal((await api('PUT', `/permisos/usuario/${u.id_usuario}`,
            { token: tAdmin, body: { permisos: { reportes: true } } })).status, 200);
        const tCajero = await iniciarSesion('cajero.reportes@prueba.com', CLAVE);
        assert.equal((await api('GET', '/reportes/inventario-valorado/1', { token: tCajero })).status, 403);
        assert.equal((await api('GET', '/reportes/kardex/1?id_producto=1&fecha_inicio=2026-11-01&fecha_fin=2026-11-02', { token: tCajero })).status, 403);
        assert.equal((await api('GET', '/reportes/inventario-valorado/1', { token: tAdmin })).status, 200);
    });
});

describe('Receta elegida al crear o editar el producto', () => {
    const nuevaReceta = async (nombre, inversion, rendimiento = 10) => (await bd.sql(
        `INSERT INTO receta (nombre, rendimiento, inversion) VALUES ($1, $2, $3) RETURNING id_receta`,
        [nombre, rendimiento, inversion]))[0].id_receta;
    const recetaDe = async (id_producto) =>
        (await bd.sql(`SELECT id_receta FROM receta WHERE id_producto = $1`, [id_producto]))[0]?.id_receta ?? null;

    test('al crear con receta, el stock inicial ya entra con su costo; se puede cambiar o quitar', async () => {
        const [{ id_categoria: cat }] = await bd.sql(`SELECT min(id_categoria) AS id_categoria FROM categoria_producto`);
        const r1 = await nuevaReceta('RECETA FORMULARIO 1', 18);       // 1,80
        const r2 = await nuevaReceta('RECETA FORMULARIO 2', 30);       // 3,00
        const creado = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
            nombre_producto: 'Con receta al crear', precio_unitario: 5, id_categoria: cat, id_sucursal: 1, stock_inicial: 4, id_receta: r1 } });
        assert.equal(creado.status, 201, JSON.stringify(creado.body));
        const id = creado.body.producto.id_producto;
        assert.equal(await recetaDe(id), r1);
        assert.equal(Number((await lotes(id))[0].costo_unitario), 1.8);

        assert.equal((await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { id_receta: r2 } })).status, 200);
        assert.equal(await recetaDe(id), r2);
        assert.equal((await bd.sql(`SELECT id_producto FROM receta WHERE id_receta = $1`, [r1]))[0].id_producto, null, 'la anterior queda libre');

        // Una receta es de un solo producto
        const otro = await api('POST', '/catalogo/productos', { token: tAdmin, body: {
            nombre_producto: 'Quiere la misma receta', precio_unitario: 5, id_categoria: cat, id_sucursal: 1, id_receta: r2 } });
        assert.equal(otro.status, 400);
        assert.match(otro.body.error, /ya es de/i);

        assert.equal((await api('PUT', `/catalogo/productos/${id}`, { token: tAdmin, body: { id_receta: null } })).status, 200);
        assert.equal(await recetaDe(id), null);
    });
});

describe('Kardex: lo cargado de a uno en una mesa es un solo movimiento', () => {
    test('4 toques a la misma línea de la cuenta = una salida de 4; otra venta queda aparte', async () => {
        const id = await crearProducto('Kardex mesa de a uno');
        await ingresar(id, 10);
        const mesa = await nuevaMesa();
        const cuenta = (await api('POST', '/cuentas/abrir', { token: tAdmin, body: { id_mesa: mesa.id_mesa } })).body.cuenta;
        for (let i = 0; i < 4; i++)
            assert.equal((await api('POST', `/cuentas/${cuenta.id_cuenta}/producto`, { token: tAdmin, body: { id_producto: id, cantidad: 1 } })).status, 201);
        assert.equal((await cobrar([{ id_producto: id, cantidad: 2 }])).status, 201);

        const hoy = (await bd.sql(`SELECT to_char((now() AT TIME ZONE 'America/La_Paz')::date, 'YYYY-MM-DD') AS d`))[0].d;
        const k = (await api('GET', `/reportes/kardex/1?id_producto=${id}&fecha_inicio=${hoy}&fecha_fin=${hoy}`, { token: tAdmin })).body;
        assert.deepEqual(k.movimientos.map(m => [m.motivo, m.cantidad, m.saldo.cantidad]),
                         [['Producción', 10, 10], ['Cuenta de mesa', 4, 6], ['Venta en Caja', 2, 4]]);
        assert.equal(k.totales.salidas, 6);
    });
});
