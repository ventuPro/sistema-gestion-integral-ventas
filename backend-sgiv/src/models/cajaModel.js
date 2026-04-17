const db = require('../config/db');

// --- TURNOS DE CAJA ---
const abrirTurno = async (id_sucursal, id_usuario_cajero, monto_inicial) => {
    const query = `
        INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
        VALUES ($1, $2, $3, 'Abierto') RETURNING *;
    `;
    const result = await db.query(query, [id_sucursal, id_usuario_cajero, monto_inicial]);
    return result.rows[0];
};

const cerrarTurno = async (id_turno, monto_real_declarado) => {
    // Aquí actualizamos el turno a Cerrado y calculamos diferencias (se podría mejorar sumando ventas reales)
    const query = `
        UPDATE turno_caja 
        SET fecha_hora_cierre = CURRENT_TIMESTAMP, 
            monto_real_declarado = $2, 
            estado_turno = 'Cerrado'
        WHERE id_turno = $1 RETURNING *;
    `;
    const result = await db.query(query, [id_turno, monto_real_declarado]);
    return result.rows[0];
};

// --- VENTAS ---
const registrarVenta = async (datosVenta) => {
    const { id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago, detalles } = datosVenta;
    
    const client = await db.connect();
    try {
        await client.query('BEGIN'); // Iniciar Transacción

        // 1. Insertar la Venta Principal
        const queryVenta = `
            INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_venta;
        `;
        const resVenta = await client.query(queryVenta, [id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago]);
        const id_venta = resVenta.rows[0].id_venta;

        // 2. Procesar los Detalles de la Venta y Descontar Inventario
        for (let item of detalles) {
            // Insertar detalle de venta
            const queryDetalle = `
                INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                VALUES ($1, $2, $3, $4, $5);
            `;
            await client.query(queryDetalle, [id_venta, item.id_producto, item.cantidad, item.precio, item.subtotal]);

            // Descontar del inventario
            const queryInventario = `
                UPDATE inventario_sucursal 
                SET cantidad_actual = cantidad_actual - $1 
                WHERE id_sucursal = $2 AND id_producto = $3 RETURNING id_inventario;
            `;
            const resInv = await client.query(queryInventario, [item.cantidad, id_sucursal, item.id_producto]);

            // Registrar en historial de inventario (Salida por Venta)
            if (resInv.rows.length > 0) {
                const queryHistorial = `
                    INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                    VALUES ($1, $2, 'SALIDA', $3, 'Venta en Caja');
                `;
                await client.query(queryHistorial, [resInv.rows[0].id_inventario, id_usuario_cajero, item.cantidad]);
            }
        }

        // 3. Si la venta viene de un Pedido QR, actualizar el pedido a 'Pagado' y liberar la mesa
        if (id_pedido_mesa) {
            await client.query(`UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1`, [id_pedido_mesa]);
            // Buscar la mesa asociada al pedido y liberarla
            await client.query(`
                UPDATE mesa_local SET estado_mesa = 'Libre' 
                WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)
            `, [id_pedido_mesa]);
        }

        await client.query('COMMIT'); // Guardar todos los cambios
        return id_venta;
    } catch (error) {
        await client.query('ROLLBACK'); // Deshacer todo si hay un error
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { abrirTurno, cerrarTurno, registrarVenta };