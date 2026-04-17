const db = require('../config/db');

// --- GESTIÓN DE MESAS ---
const crearMesa = async (id_sucursal, numero_mesa, codigo_qr) => {
    const query = `
        INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
        VALUES ($1, $2, $3) RETURNING *;
    `;
    const result = await db.query(query, [id_sucursal, numero_mesa, codigo_qr]);
    return result.rows[0];
};

const obtenerMesasPorSucursal = async (id_sucursal) => {
    const query = `SELECT * FROM mesa_local WHERE id_sucursal = $1 ORDER BY numero_mesa ASC;`;
    const result = await db.query(query, [id_sucursal]);
    return result.rows;
};

// --- GESTIÓN DE PEDIDOS (MENÚ DIGITAL) ---
const crearPedido = async (id_mesa) => {
    // Primero, cambiamos el estado de la mesa a 'Ocupada'
    await db.query(`UPDATE mesa_local SET estado_mesa = 'Ocupada' WHERE id_mesa = $1`, [id_mesa]);

    // Luego creamos el pedido
    const query = `
        INSERT INTO pedido_mesa (id_mesa, estado_pedido, monto_total)
        VALUES ($1, 'Pendiente', 0.00) RETURNING *;
    `;
    const result = await db.query(query, [id_mesa]);
    return result.rows[0];
};

const agregarDetallePedido = async (id_pedido, id_producto, cantidad_solicitada, precio_aplicado, nota_cliente) => {
    const subtotal_detalle = cantidad_solicitada * precio_aplicado;
    
    // Insertamos el producto en el detalle del pedido
    const queryDetalle = `
        INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad_solicitada, precio_aplicado, subtotal_detalle, nota_cliente)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `;
    const result = await db.query(queryDetalle, [id_pedido, id_producto, cantidad_solicitada, precio_aplicado, subtotal_detalle, nota_cliente]);
    
    // Actualizamos el monto total del pedido principal sumando este nuevo subtotal
    await db.query(`UPDATE pedido_mesa SET monto_total = monto_total + $1 WHERE id_pedido = $2`, [subtotal_detalle, id_pedido]);

    return result.rows[0];
};

module.exports = { crearMesa, obtenerMesasPorSucursal, crearPedido, agregarDetallePedido };