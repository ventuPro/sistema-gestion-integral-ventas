const db = require('../config/db');

// ─── Pedidos del cliente: Pendiente_Cajero → Confirmado → Entregado → Pagado / Cancelado ───

const MAX_ITEMS_PEDIDO      = 30;   // productos distintos por pedido
const MAX_CANTIDAD_ITEM     = 50;   // unidades de un producto por pedido
const MAX_PENDIENTES_MESA   = 3;    // pedidos sin confirmar a la vez por mesa
const MAX_LARGO_NOTA        = 200;

const errorCodigo = (code, message, extra = {}) =>
    Object.assign(new Error(message), { code }, extra);

const enTransaccion = async (fn) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const texto = (valor, max) => {
    const t = String(valor ?? '').trim().slice(0, max);
    return t || null;
};

// ─── Validación del carrito (el precio sale de la BD) ───
const normalizarItems = (items) => {
    if (!Array.isArray(items) || items.length === 0)
        throw errorCodigo('PEDIDO_INVALIDO', 'El pedido está vacío');

    const porProducto = new Map();
    for (const it of items) {
        const id_producto = Number(it?.id_producto);
        const cantidad    = Number(it?.cantidad);
        if (!Number.isInteger(id_producto) || id_producto <= 0 ||
            !Number.isInteger(cantidad)    || cantidad <= 0)
            throw errorCodigo('PEDIDO_INVALIDO', 'Producto o cantidad inválidos');

        const nota   = texto(it.nota_cliente, MAX_LARGO_NOTA);
        const previo = porProducto.get(id_producto);
        if (previo) {
            previo.cantidad += cantidad;
            if (nota) previo.nota = texto([previo.nota, nota].filter(Boolean).join('; '), MAX_LARGO_NOTA);
        } else {
            porProducto.set(id_producto, { id_producto, cantidad, nota });
        }
    }

    const lista = [...porProducto.values()];
    if (lista.length > MAX_ITEMS_PEDIDO)
        throw errorCodigo('PEDIDO_INVALIDO', `Máximo ${MAX_ITEMS_PEDIDO} productos distintos por pedido`);
    if (lista.some(i => i.cantidad > MAX_CANTIDAD_ITEM))
        throw errorCodigo('PEDIDO_INVALIDO', `Máximo ${MAX_CANTIDAD_ITEM} unidades por producto`);

    // Orden fijo: evita deadlocks
    return lista.sort((a, b) => a.id_producto - b.id_producto);
};

// ─── Stock (descuento atómico) ───
const reservarStock = async (client, id_sucursal, items) => {
    const cambios = [];
    for (const it of items) {
        const r = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual - $1
            WHERE id_sucursal = $2 AND id_producto = $3 AND cantidad_actual >= $1
            RETURNING cantidad_actual
        `, [it.cantidad, id_sucursal, it.id_producto]);

        if (r.rows.length === 0) {
            const rInfo = await client.query(`
                SELECT p.nombre_producto, COALESCE(i.cantidad_actual, 0)::int AS disponible
                FROM producto p
                LEFT JOIN inventario_sucursal i ON i.id_producto = p.id_producto AND i.id_sucursal = $2
                WHERE p.id_producto = $1
            `, [it.id_producto, id_sucursal]);
            const info = rInfo.rows[0] || {};
            throw errorCodigo('STOCK_INSUFICIENTE',
                `Ya no hay suficiente "${info.nombre_producto || it.id_producto}" (disponible: ${info.disponible ?? 0})`,
                { id_producto: it.id_producto, disponible: info.disponible ?? 0 });
        }
        cambios.push({ id_producto: it.id_producto, id_sucursal, nuevo_stock: Number(r.rows[0].cantidad_actual) });
    }
    return cambios;
};

const devolverStock = async (client, id_sucursal, items) => {
    const cambios = [];
    for (const it of items) {
        const r = await client.query(`
            UPDATE inventario_sucursal
            SET cantidad_actual = cantidad_actual + $1
            WHERE id_sucursal = $2 AND id_producto = $3
            RETURNING cantidad_actual
        `, [it.cantidad, id_sucursal, it.id_producto]);
        if (r.rows.length)
            cambios.push({ id_producto: it.id_producto, id_sucursal, nuevo_stock: Number(r.rows[0].cantidad_actual) });
    }
    return cambios;
};

const recalcularMontoPedido = (client, id_pedido) => client.query(`
    UPDATE pedido_mesa
    SET monto_total = (SELECT COALESCE(SUM(subtotal_detalle), 0) FROM detalle_pedido WHERE id_pedido = $1)
    WHERE id_pedido = $1
    RETURNING monto_total
`, [id_pedido]);

const exigirId = (id) => {
    if (!Number.isInteger(id) || id <= 0) throw errorCodigo('PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
};

// id_sucursal null = sin filtro (admin)
const bloquearPedido = async (client, id_pedido, id_sucursal) => {
    exigirId(id_pedido);
    const r = await client.query(`
        SELECT * FROM pedido_mesa
        WHERE id_pedido = $1 AND ($2::int IS NULL OR id_sucursal = $2)
        FOR UPDATE
    `, [id_pedido, id_sucursal ?? null]);
    if (!r.rows.length) throw errorCodigo('PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    return r.rows[0];
};

const exigirEstado = (pedido, estado) => {
    if (pedido.estado_pedido !== estado)
        throw errorCodigo('PEDIDO_YA_PROCESADO', 'El pedido ya fue atendido', { estado_actual: pedido.estado_pedido });
};

const itemsDelPedido = async (client, id_pedido) =>
    (await client.query(
        `SELECT id_producto, cantidad_solicitada AS cantidad FROM detalle_pedido WHERE id_pedido = $1`,
        [id_pedido])).rows;

// ─── Mesa por código QR ───
const obtenerMesaPorCodigo = async (codigo) => {
    const r = await db.query(`
        SELECT m.id_mesa, m.numero_mesa, m.id_sucursal, s.nombre_sucursal,
               s.estado_activo AND EXISTS (SELECT 1 FROM turno_caja t
                       WHERE t.id_sucursal = m.id_sucursal AND t.estado_turno = 'Abierto') AS recibe_pedidos
        FROM mesa_local m
        JOIN sucursal   s ON s.id_sucursal = m.id_sucursal
        WHERE m.codigo_qr = $1
    `, [String(codigo || '')]);
    return r.rows[0] || null;
};

// ─── Catálogo del menú (incluye agotados) ───
const obtenerCatalogoMenu = async (id_sucursal) => {
    const r = await db.query(`
        SELECT p.id_producto, p.nombre_producto, p.descripcion_producto,
               p.precio_unitario, p.url_imagen,
               c.id_categoria, c.nombre_categoria,
               GREATEST(i.cantidad_actual, 0)::int AS stock_actual
        FROM producto p
        JOIN categoria_producto  c ON c.id_categoria = p.id_categoria
        JOIN inventario_sucursal i ON i.id_producto  = p.id_producto AND i.id_sucursal = $1
        WHERE p.estado_activo = TRUE AND p.mostrar_en_menu IS NOT FALSE
        ORDER BY c.nombre_categoria, p.nombre_producto
    `, [id_sucursal]);
    return r.rows;
};

// ─── CLIENTE: crear pedido desde la mesa ───
const crearPedidoMesa = async ({ mesa, items, observacion_general, maxPendientes = MAX_PENDIENTES_MESA }) => {
    const lista = normalizarItems(items);

    return enTransaccion(async (client) => {
        await client.query(`SELECT id_mesa FROM mesa_local WHERE id_mesa = $1 FOR UPDATE`, [mesa.id_mesa]);

        const rTurno = await client.query(
            `SELECT 1 FROM turno_caja t JOIN sucursal s ON s.id_sucursal = t.id_sucursal
             WHERE t.id_sucursal = $1 AND t.estado_turno = 'Abierto' AND s.estado_activo LIMIT 1`,
            [mesa.id_sucursal]);
        if (!rTurno.rows.length)
            throw errorCodigo('NO_RECIBE_PEDIDOS', 'En este momento no estamos recibiendo pedidos desde el menú. Consulta en caja.');

        const rPend = await client.query(
            `SELECT COUNT(*)::int AS n FROM pedido_mesa WHERE id_mesa = $1 AND estado_pedido = 'Pendiente_Cajero'`,
            [mesa.id_mesa]);
        if (rPend.rows[0].n >= maxPendientes)
            throw errorCodigo('DEMASIADOS_PENDIENTES', 'Tu mesa ya tiene pedidos esperando confirmación. Espera a que el cajero los confirme.');

        const rProd = await client.query(`
            SELECT id_producto, precio_unitario FROM producto
            WHERE id_producto = ANY($1::int[]) AND estado_activo = TRUE AND mostrar_en_menu IS NOT FALSE
        `, [lista.map(i => i.id_producto)]);
        const precios = new Map(rProd.rows.map(p => [p.id_producto, Math.round(Number(p.precio_unitario) * 100)]));
        const noDisponible = lista.find(i => !precios.has(i.id_producto));
        if (noDisponible)
            throw errorCodigo('PRODUCTO_NO_DISPONIBLE', 'Un producto de tu pedido ya no está disponible. Revisa tu carrito.',
                              { id_producto: noDisponible.id_producto });

        const cambios = await reservarStock(client, mesa.id_sucursal, lista);

        const totalCentavos = lista.reduce((s, i) => s + precios.get(i.id_producto) * i.cantidad, 0);
        const rPed = await client.query(`
            INSERT INTO pedido_mesa (tipo_pedido, id_sucursal, id_mesa, estado_pedido, monto_total, observacion_general)
            VALUES ('Mesa', $1, $2, 'Pendiente_Cajero', $3, $4)
            RETURNING *
        `, [mesa.id_sucursal, mesa.id_mesa, totalCentavos / 100, texto(observacion_general, MAX_LARGO_NOTA)]);
        const pedido = rPed.rows[0];

        for (const it of lista) {
            const precio = precios.get(it.id_producto);
            await client.query(`
                INSERT INTO detalle_pedido
                    (id_pedido, id_producto, cantidad_solicitada, precio_aplicado, subtotal_detalle, nota_cliente)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [pedido.id_pedido, it.id_producto, it.cantidad, precio / 100, (precio * it.cantidad) / 100, it.nota]);
        }

        return { pedido, cambios };
    });
};

// ─── CAJERO: bandeja ───
const obtenerBandeja = async (id_sucursal, minutos_expiracion) => {
    const r = await db.query(`
        SELECT pm.id_pedido, pm.tipo_pedido, pm.id_mesa, pm.id_sucursal, pm.estado_pedido,
               pm.monto_total, pm.fecha_pedido, pm.fecha_aprobacion, pm.observacion_general,
               pm.fecha_pedido + make_interval(mins => $2) AS fecha_expiracion,
               pm.nombre_cliente, pm.telefono_cliente, pm.direccion_entrega,
               m.numero_mesa,
               json_agg(json_build_object(
                   'id_detalle',      dp.id_detalle_pedido,
                   'id_producto',     dp.id_producto,
                   'nombre_producto', p.nombre_producto,
                   'cantidad',        dp.cantidad_solicitada,
                   'precio',          dp.precio_aplicado,
                   'subtotal',        dp.subtotal_detalle,
                   'nota_cliente',    dp.nota_cliente,
                   'stock_disponible', COALESCE(i.cantidad_actual, 0)
               ) ORDER BY dp.id_detalle_pedido) AS items
        FROM pedido_mesa pm
        LEFT JOIN mesa_local m ON m.id_mesa = pm.id_mesa
        JOIN detalle_pedido  dp ON dp.id_pedido = pm.id_pedido
        JOIN producto        p  ON p.id_producto = dp.id_producto
        LEFT JOIN inventario_sucursal i ON i.id_producto = dp.id_producto AND i.id_sucursal = pm.id_sucursal
        WHERE pm.id_sucursal = $1
          AND pm.estado_pedido IN ('Pendiente_Cajero', 'Confirmado')
        GROUP BY pm.id_pedido, m.numero_mesa
        ORDER BY pm.fecha_pedido ASC
    `, [id_sucursal, minutos_expiracion]);
    return r.rows;
};

// ─── CAJERO: ajustar cantidad (0 = quitar) ───
const ajustarDetalle = async ({ id_pedido, id_detalle, cantidad, id_sucursal }) => {
    const nueva = Number(cantidad);
    if (!Number.isInteger(nueva) || nueva < 0 || nueva > MAX_CANTIDAD_ITEM)
        throw errorCodigo('PEDIDO_INVALIDO', 'Cantidad inválida');

    return enTransaccion(async (client) => {
        const pedido = await bloquearPedido(client, id_pedido, id_sucursal);
        exigirEstado(pedido, 'Pendiente_Cajero');

        exigirId(id_detalle);
        const rDet = await client.query(
            `SELECT * FROM detalle_pedido WHERE id_detalle_pedido = $1 AND id_pedido = $2`,
            [id_detalle, id_pedido]);
        if (!rDet.rows.length) throw errorCodigo('PEDIDO_NO_ENCONTRADO', 'Producto no encontrado en el pedido');
        const det   = rDet.rows[0];
        const delta = nueva - Number(det.cantidad_solicitada);

        let cambios = [];
        if (nueva === 0) {
            const rOtros = await client.query(
                `SELECT COUNT(*)::int AS n FROM detalle_pedido WHERE id_pedido = $1 AND id_detalle_pedido <> $2`,
                [id_pedido, id_detalle]);
            if (rOtros.rows[0].n === 0)
                throw errorCodigo('ULTIMO_PRODUCTO', 'Es el único producto del pedido: recházalo en lugar de quitarlo');
            cambios = await devolverStock(client, pedido.id_sucursal,
                                          [{ id_producto: det.id_producto, cantidad: det.cantidad_solicitada }]);
            await client.query(`DELETE FROM detalle_pedido WHERE id_detalle_pedido = $1`, [id_detalle]);
        } else if (delta !== 0) {
            const mov = { id_producto: det.id_producto, cantidad: Math.abs(delta) };
            cambios = delta > 0
                ? await reservarStock(client, pedido.id_sucursal, [mov])
                : await devolverStock(client, pedido.id_sucursal, [mov]);
            await client.query(`
                UPDATE detalle_pedido
                SET cantidad_solicitada = $1::int, subtotal_detalle = $1::int * precio_aplicado
                WHERE id_detalle_pedido = $2
            `, [nueva, id_detalle]);
        }

        const rMonto = await recalcularMontoPedido(client, id_pedido);
        return { pedido, cambios, monto_total: rMonto.rows[0].monto_total };
    });
};

// ─── CAJERO: confirmar (pasa a la cuenta de la mesa) ───
const confirmarPedido = async ({ id_pedido, id_usuario, id_sucursal }) =>
    enTransaccion(async (client) => {
        const pedido = await bloquearPedido(client, id_pedido, id_sucursal);
        exigirEstado(pedido, 'Pendiente_Cajero');
        if (pedido.tipo_pedido !== 'Mesa' || !pedido.id_mesa)
            throw errorCodigo('PEDIDO_INVALIDO', 'Solo los pedidos de mesa se integran a una cuenta');

        let rCuenta = await client.query(
            `SELECT id_cuenta FROM cuenta_mesa WHERE id_mesa = $1 AND estado = 'Abierta' FOR UPDATE`,
            [pedido.id_mesa]);
        let cuenta_nueva = false;
        if (!rCuenta.rows.length) {
            rCuenta = await client.query(`
                INSERT INTO cuenta_mesa (id_mesa, id_usuario_apertura, estado, total_acumulado)
                VALUES ($1, $2, 'Abierta', 0) RETURNING id_cuenta
            `, [pedido.id_mesa, id_usuario]);
            cuenta_nueva = true;
        }
        const id_cuenta = rCuenta.rows[0].id_cuenta;

        // Stock ya reservado: no se descuenta de nuevo
        await client.query(`
            INSERT INTO detalle_cuenta (id_cuenta, id_producto, cantidad, precio_unitario, subtotal, nota, origen)
            SELECT $1, id_producto, cantidad_solicitada, precio_aplicado, subtotal_detalle, nota_cliente, 'qr'
            FROM detalle_pedido WHERE id_pedido = $2
            ORDER BY id_detalle_pedido
        `, [id_cuenta, id_pedido]);
        await client.query(`
            UPDATE cuenta_mesa
            SET total_acumulado = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_cuenta WHERE id_cuenta = $1)
            WHERE id_cuenta = $1
        `, [id_cuenta]);
        await client.query(`UPDATE mesa_local SET estado_mesa = 'Ocupada' WHERE id_mesa = $1`, [pedido.id_mesa]);

        const rPed = await client.query(`
            UPDATE pedido_mesa
            SET estado_pedido = 'Confirmado', id_cuenta = $2, id_usuario_atencion = $3,
                fecha_aprobacion = CURRENT_TIMESTAMP
            WHERE id_pedido = $1
            RETURNING *
        `, [id_pedido, id_cuenta, id_usuario]);

        return { pedido: rPed.rows[0], id_cuenta, cuenta_nueva };
    });

// Pedido ya bloqueado
const cancelarPendiente = async (client, pedido, id_usuario = null) => {
    const cambios = await devolverStock(client, pedido.id_sucursal, await itemsDelPedido(client, pedido.id_pedido));
    const r = await client.query(`
        UPDATE pedido_mesa SET estado_pedido = 'Cancelado', id_usuario_atencion = COALESCE($2, id_usuario_atencion)
        WHERE id_pedido = $1 RETURNING *
    `, [pedido.id_pedido, id_usuario]);
    return { pedido: r.rows[0], cambios };
};

// ─── CAJERO: rechazar (sin motivo) ───
const rechazarPedido = async ({ id_pedido, id_usuario, id_sucursal }) =>
    enTransaccion(async (client) => {
        const pedido = await bloquearPedido(client, id_pedido, id_sucursal);
        exigirEstado(pedido, 'Pendiente_Cajero');
        return cancelarPendiente(client, pedido, id_usuario);
    });

// ─── CLIENTE: cancelar ───
const cancelarPorCliente = async ({ id_pedido, id_mesa }) =>
    enTransaccion(async (client) => {
        const pedido = await bloquearPedido(client, id_pedido, null);
        if (pedido.id_mesa !== id_mesa) throw errorCodigo('PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
        exigirEstado(pedido, 'Pendiente_Cajero');
        return cancelarPendiente(client, pedido);
    });

// ─── CAJERO: entregado ───
const marcarEntregado = async ({ id_pedido, id_sucursal }) => {
    exigirId(id_pedido);
    const r = await db.query(`
        UPDATE pedido_mesa SET estado_pedido = 'Entregado', fecha_entrega = CURRENT_TIMESTAMP
        WHERE id_pedido = $1 AND ($2::int IS NULL OR id_sucursal = $2) AND estado_pedido = 'Confirmado'
        RETURNING *
    `, [id_pedido, id_sucursal ?? null]);
    if (r.rows.length) return r.rows[0];

    const rExiste = await db.query(
        `SELECT estado_pedido FROM pedido_mesa WHERE id_pedido = $1 AND ($2::int IS NULL OR id_sucursal = $2)`,
        [id_pedido, id_sucursal ?? null]);
    if (!rExiste.rows.length) throw errorCodigo('PEDIDO_NO_ENCONTRADO', 'Pedido no encontrado');
    throw errorCodigo('PEDIDO_YA_PROCESADO', 'El pedido no está confirmado', { estado_actual: rExiste.rows[0].estado_pedido });
};

// ─── Integración con cuentas y mesas ───

const finalizarPedidosDeCuenta = async (client, id_cuenta, estadoFinal) =>
    (await client.query(`
        UPDATE pedido_mesa SET estado_pedido = $2
        WHERE id_cuenta = $1 AND estado_pedido IN ('Confirmado', 'Entregado')
        RETURNING id_pedido
    `, [id_cuenta, estadoFinal])).rows.map(r => r.id_pedido);

const cancelarPendientesMesa = async (client, id_mesa) => {
    const rPend = await client.query(
        `SELECT * FROM pedido_mesa WHERE id_mesa = $1 AND estado_pedido = 'Pendiente_Cajero' ORDER BY id_pedido FOR UPDATE`,
        [id_mesa]);
    let cambios = [];
    for (const pedido of rPend.rows)
        cambios = cambios.concat((await cancelarPendiente(client, pedido)).cambios);
    return { cambios, ids: rPend.rows.map(p => p.id_pedido) };
};

// ─── CLIENTE: estado de sus pedidos y consumo de la mesa ───
const obtenerEstadoMesa = async (id_mesa, ids) => {
    const rPed = await db.query(`
        SELECT pm.id_pedido, pm.estado_pedido, pm.monto_total, pm.fecha_pedido,
               json_agg(json_build_object(
                   'nombre_producto', p.nombre_producto,
                   'cantidad',        dp.cantidad_solicitada,
                   'subtotal',        dp.subtotal_detalle,
                   'nota_cliente',    dp.nota_cliente
               ) ORDER BY dp.id_detalle_pedido) AS items
        FROM pedido_mesa pm
        JOIN detalle_pedido dp ON dp.id_pedido = pm.id_pedido
        JOIN producto       p  ON p.id_producto = dp.id_producto
        WHERE pm.id_mesa = $1 AND pm.id_pedido = ANY($2::int[])
        GROUP BY pm.id_pedido
        ORDER BY pm.id_pedido
    `, [id_mesa, ids]);

    const rCuenta = await db.query(`
        SELECT c.id_cuenta, c.total_acumulado,
               COALESCE((
                   SELECT json_agg(x ORDER BY x.nombre_producto)
                   FROM (SELECT p.nombre_producto, SUM(dc.cantidad)::int AS cantidad, SUM(dc.subtotal) AS subtotal
                         FROM detalle_cuenta dc JOIN producto p ON p.id_producto = dc.id_producto
                         WHERE dc.id_cuenta = c.id_cuenta
                         GROUP BY p.nombre_producto) x
               ), '[]'::json) AS items
        FROM cuenta_mesa c
        WHERE c.id_mesa = $1 AND c.estado = 'Abierta'
    `, [id_mesa]);

    return { pedidos: rPed.rows, cuenta: rCuenta.rows[0] || null };
};

// ─── Pendientes sin atender: se cancelan solos ───
const expirarPendientes = async (minutos) =>
    enTransaccion(async (client) => {
        const r = await client.query(`
            SELECT * FROM pedido_mesa
            WHERE estado_pedido = 'Pendiente_Cajero'
              AND fecha_pedido < LOCALTIMESTAMP - make_interval(mins => $1)
            ORDER BY id_pedido
            FOR UPDATE SKIP LOCKED
        `, [minutos]);
        let cambios = [];
        const pedidos = [];
        for (const p of r.rows) {
            const x = await cancelarPendiente(client, p);
            cambios = cambios.concat(x.cambios);
            pedidos.push(x.pedido);
        }
        return { pedidos, cambios };
    });

module.exports = {
    MAX_PENDIENTES_MESA,
    obtenerMesaPorCodigo, obtenerCatalogoMenu,
    crearPedidoMesa, cancelarPorCliente, obtenerEstadoMesa,
    obtenerBandeja, ajustarDetalle, confirmarPedido, rechazarPedido, marcarEntregado,
    finalizarPedidosDeCuenta, cancelarPendientesMesa, expirarPendientes
};
