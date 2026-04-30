const db = require('../config/db');

// ─── MESAS ───
const crearMesa = async (id_sucursal, numero_mesa, codigo_qr) => {
    const result = await db.query(
        `INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
         VALUES ($1, $2, $3) RETURNING *;`,
        [id_sucursal, numero_mesa, codigo_qr]
    );
    return result.rows[0];
};

const obtenerMesasPorSucursal = async (id_sucursal) => {
    const result = await db.query(
        `SELECT * FROM mesa_local WHERE id_sucursal = $1 ORDER BY numero_mesa ASC;`,
        [id_sucursal]
    );
    return result.rows;
};

// ─── PEDIDOS ───

// Cliente crea pedido (estado: 'Pendiente_Cajero')
const crearPedido = async (id_mesa, observacion_general = '') => {
    // Marcar mesa como Ocupada
    await db.query(
        `UPDATE mesa_local SET estado_mesa = 'Ocupada' WHERE id_mesa = $1`,
        [id_mesa]
    );
    const result = await db.query(
        `INSERT INTO pedido_mesa (id_mesa, estado_pedido, monto_total, observacion_general)
         VALUES ($1, 'Pendiente_Cajero', 0.00, $2) RETURNING *;`,
        [id_mesa, observacion_general]
    );
    return result.rows[0];
};

// Agregar producto al pedido
const agregarDetallePedido = async (id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente = '') => {
    const subtotal = cantidad_solicitada * precio_aplicado;
    const result   = await db.query(
        `INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad_solicitada, precio_aplicado, subtotal_detalle, nota_cliente, estado_cocina)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pendiente') RETURNING *;`,
        [id_pedido, id_producto, cantidad_solicitada, precio_aplicado, subtotal, nota_cliente]
    );
    await db.query(
        `UPDATE pedido_mesa SET monto_total = monto_total + $1 WHERE id_pedido = $2`,
        [subtotal, id_pedido]
    );
    return result.rows[0];
};

// Obtener pedido completo con detalles
const obtenerPedidoCompleto = async (id_pedido) => {
    const pedido = await db.query(
        `SELECT pm.*, m.numero_mesa, m.id_sucursal
         FROM pedido_mesa pm
         JOIN mesa_local m ON pm.id_mesa = m.id_mesa
         WHERE pm.id_pedido = $1;`,
        [id_pedido]
    );
    if (!pedido.rows[0]) return null;

    const detalles = await db.query(
        `SELECT dp.*, p.nombre_producto, p.url_imagen, c.nombre_categoria
         FROM detalle_pedido dp
         JOIN producto p ON dp.id_producto = p.id_producto
         JOIN categoria_producto c ON p.id_categoria = c.id_categoria
         WHERE dp.id_pedido = $1
         ORDER BY dp.id_detalle_pedido ASC;`,
        [id_pedido]
    );

    return { ...pedido.rows[0], detalles: detalles.rows };
};

// Obtener todos los pedidos pendientes de cajero de una sucursal
const obtenerPedidosPendientesCajero = async (id_sucursal) => {
    const result = await db.query(
        `SELECT pm.*, m.numero_mesa,
                json_agg(
                    json_build_object(
                        'id_detalle', dp.id_detalle_pedido,
                        'nombre_producto', p.nombre_producto,
                        'cantidad', dp.cantidad_solicitada,
                        'precio', dp.precio_aplicado,
                        'subtotal', dp.subtotal_detalle,
                        'nota_cliente', dp.nota_cliente,
                        'estado_cocina', dp.estado_cocina
                    ) ORDER BY dp.id_detalle_pedido
                ) AS items
         FROM pedido_mesa pm
         JOIN mesa_local m ON pm.id_mesa = m.id_mesa
         JOIN detalle_pedido dp ON dp.id_pedido = pm.id_pedido
         JOIN producto p ON dp.id_producto = p.id_producto
         WHERE m.id_sucursal = $1
           AND pm.estado_pedido = 'Pendiente_Cajero'
         GROUP BY pm.id_pedido, m.numero_mesa
         ORDER BY pm.fecha_pedido ASC;`,
        [id_sucursal]
    );
    return result.rows;
};

// CAJERO: Aprobar pedido → va a cocina
const aprobarPedido = async (id_pedido) => {
    const result = await db.query(
        `UPDATE pedido_mesa
         SET estado_pedido = 'En_Cocina', fecha_aprobacion = CURRENT_TIMESTAMP
         WHERE id_pedido = $1 RETURNING *;`,
        [id_pedido]
    );
    // Actualizar todos los detalles a 'Pendiente' (ya lo están, pero confirmamos)
    await db.query(
        `UPDATE detalle_pedido SET estado_cocina = 'Pendiente'
         WHERE id_pedido = $1 AND estado_cocina = 'Pendiente';`,
        [id_pedido]
    );
    return result.rows[0];
};

// CAJERO: Rechazar pedido
const rechazarPedido = async (id_pedido) => {
    const result = await db.query(
        `UPDATE pedido_mesa SET estado_pedido = 'Cancelado'
         WHERE id_pedido = $1 RETURNING *, 
         (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1) AS id_mesa_ref;`,
        [id_pedido]
    );
    // Liberar mesa si no hay otros pedidos activos
    if (result.rows[0]) {
        await db.query(
            `UPDATE mesa_local SET estado_mesa = 'Libre'
             WHERE id_mesa = $1
               AND NOT EXISTS (
                   SELECT 1 FROM pedido_mesa
                   WHERE id_mesa = $1 AND estado_pedido NOT IN ('Pagado','Cancelado')
               );`,
            [result.rows[0].id_mesa]
        );
    }
    return result.rows[0];
};

// COCINA: Obtener pedidos activos en cocina
const obtenerPedidosKDS = async (id_sucursal) => {
    const result = await db.query(
        `SELECT pm.id_pedido, pm.estado_pedido, pm.fecha_aprobacion, pm.observacion_general,
                m.numero_mesa,
                json_agg(
                    json_build_object(
                        'id_detalle',    dp.id_detalle_pedido,
                        'nombre',        p.nombre_producto,
                        'categoria',     c.nombre_categoria,
                        'imagen',        p.url_imagen,
                        'cantidad',      dp.cantidad_solicitada,
                        'nota_cliente',  dp.nota_cliente,
                        'estado_cocina', dp.estado_cocina
                    ) ORDER BY dp.id_detalle_pedido
                ) AS items
         FROM pedido_mesa pm
         JOIN mesa_local m ON pm.id_mesa = m.id_mesa
         JOIN detalle_pedido dp ON dp.id_pedido = pm.id_pedido
         JOIN producto p ON dp.id_producto = p.id_producto
         JOIN categoria_producto c ON p.id_categoria = c.id_categoria
         WHERE m.id_sucursal = $1
           AND pm.estado_pedido IN ('En_Cocina', 'Listo')
         GROUP BY pm.id_pedido, m.numero_mesa
         ORDER BY pm.fecha_aprobacion ASC;`,
        [id_sucursal]
    );
    return result.rows;
};

// COCINA: Actualizar estado de un ítem
const actualizarEstadoCocinaItem = async (id_detalle, nuevo_estado) => {
    const estadosValidos = ['Pendiente', 'En_Preparacion', 'Listo'];
    if (!estadosValidos.includes(nuevo_estado)) throw new Error('Estado inválido');

    const result = await db.query(
        `UPDATE detalle_pedido SET estado_cocina = $2
         WHERE id_detalle_pedido = $1 RETURNING *, id_pedido;`,
        [id_detalle, nuevo_estado]
    );
    if (!result.rows[0]) return null;

    const id_pedido = result.rows[0].id_pedido;

    // Verificar si todos los ítems están listos → actualizar pedido
    const checkTodos = await db.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN estado_cocina = 'Listo' THEN 1 ELSE 0 END) AS listos
         FROM detalle_pedido WHERE id_pedido = $1;`,
        [id_pedido]
    );
    const { total, listos } = checkTodos.rows[0];

    if (parseInt(total) === parseInt(listos)) {
        await db.query(
            `UPDATE pedido_mesa SET estado_pedido = 'Listo', fecha_entrega = CURRENT_TIMESTAMP
             WHERE id_pedido = $1;`,
            [id_pedido]
        );
        return { ...result.rows[0], pedido_listo: true, id_pedido };
    }

    return { ...result.rows[0], pedido_listo: false, id_pedido };
};

// CLIENTE: Ver estado de su pedido (sin auth)
const obtenerEstadoPedidoPublico = async (id_pedido) => {
    const result = await db.query(
        `SELECT pm.id_pedido, pm.estado_pedido, pm.monto_total::numeric,
                pm.fecha_pedido, pm.observacion_general,
                m.numero_mesa,
                json_agg(
                    json_build_object(
                        'nombre',       p.nombre_producto,
                        'cantidad',     dp.cantidad_solicitada,
                        'nota',         dp.nota_cliente,
                        'estado',       dp.estado_cocina
                    ) ORDER BY dp.id_detalle_pedido
                ) AS items
         FROM pedido_mesa pm
         JOIN mesa_local m ON pm.id_mesa = m.id_mesa
         JOIN detalle_pedido dp ON dp.id_pedido = pm.id_pedido
         JOIN producto p ON dp.id_producto = p.id_producto
         WHERE pm.id_pedido = $1
         GROUP BY pm.id_pedido, m.numero_mesa;`,
        [id_pedido]
    );
    return result.rows[0] || null;
};

// PAGO: Cobrar pedido de mesa y liberarla
const cerrarCuentaMesa = async (id_pedido) => {
    await db.query(
        `UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1;`,
        [id_pedido]
    );
    // Liberar mesa
    const r = await db.query(
        `UPDATE mesa_local SET estado_mesa = 'Libre'
         WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)
         AND NOT EXISTS (
             SELECT 1 FROM pedido_mesa
             WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)
               AND estado_pedido NOT IN ('Pagado','Cancelado')
               AND id_pedido != $1
         ) RETURNING id_mesa;`,
        [id_pedido]
    );
    return r.rows[0];
};

module.exports = {
    crearMesa, obtenerMesasPorSucursal,
    crearPedido, agregarDetallePedido, obtenerPedidoCompleto,
    obtenerPedidosPendientesCajero, aprobarPedido, rechazarPedido,
    obtenerPedidosKDS, actualizarEstadoCocinaItem,
    obtenerEstadoPedidoPublico, cerrarCuentaMesa
};