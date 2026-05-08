const db = require('../config/db');

// ─── ESTADO DE CAJA POR USUARIO ───
const obtenerEstadoCaja = async (id_usuario) => {
    const result = await db.query(
        `SELECT caja_habilitada FROM usuario WHERE id_usuario = $1`,
        [id_usuario]
    );
    return result.rows[0];
};

const habilitarCaja = async (id_usuario) => {
    const result = await db.query(
        `UPDATE usuario SET caja_habilitada = TRUE 
         WHERE id_usuario = $1 
         RETURNING id_usuario, nombre_completo, caja_habilitada`,
        [id_usuario]
    );
    return result.rows[0];
};

const deshabilitarCaja = async (id_usuario) => {
    const result = await db.query(
        `UPDATE usuario SET caja_habilitada = FALSE 
         WHERE id_usuario = $1 
         RETURNING id_usuario, nombre_completo, caja_habilitada`,
        [id_usuario]
    );
    return result.rows[0];
};

// ─── TURNOS DE CAJA ───
const abrirTurno = async (id_sucursal, id_usuario_cajero, monto_inicial) => {
    // Verificar que el cajero tenga caja habilitada
    const check = await db.query(
        `SELECT caja_habilitada FROM usuario WHERE id_usuario = $1`,
        [id_usuario_cajero]
    );
    if (!check.rows[0]?.caja_habilitada) {
        throw new Error('CAJA_NO_HABILITADA');
    }

    // Verificar que no tenga un turno ya abierto
    const turnoAbierto = await db.query(
        `SELECT id_turno FROM turno_caja 
         WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'`,
        [id_usuario_cajero]
    );
    if (turnoAbierto.rows.length > 0) {
        throw new Error('YA_TIENE_TURNO_ABIERTO');
    }

    const query = `
        INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
        VALUES ($1, $2, $3, 'Abierto') RETURNING *;
    `;
    const result = await db.query(query, [id_sucursal, id_usuario_cajero, monto_inicial]);
    return result.rows[0];
};

const cerrarTurno = async (id_turno, monto_real_declarado) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Cerrar el turno
        const resTurno = await client.query(`
            UPDATE turno_caja 
            SET fecha_hora_cierre = CURRENT_TIMESTAMP, 
                monto_real_declarado = $2, 
                estado_turno = 'Cerrado'
            WHERE id_turno = $1 
            RETURNING *
        `, [id_turno, monto_real_declarado]);

        const turno = resTurno.rows[0];

        // Deshabilitar la caja del cajero automáticamente al cerrar
        if (turno?.id_usuario_cajero) {
            await client.query(
                `UPDATE usuario SET caja_habilitada = FALSE WHERE id_usuario = $1`,
                [turno.id_usuario_cajero]
            );
        }

        await client.query('COMMIT');
        return turno;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const obtenerTurnoAbierto = async (id_usuario_cajero) => {
    const result = await db.query(
        `SELECT * FROM turno_caja 
         WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
         ORDER BY fecha_hora_apertura DESC LIMIT 1`,
        [id_usuario_cajero]
    );
    return result.rows[0] || null;
};

const registrarVenta = async (datosVenta) => {
    const { id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, monto_total_venta, metodo_pago, detalles } = datosVenta;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Buscar turno abierto del cajero
        const resTurno = await client.query(
            `SELECT id_turno FROM turno_caja 
             WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto' 
             ORDER BY fecha_hora_apertura DESC LIMIT 1`,
            [id_usuario_cajero]
        );
        const id_turno = resTurno.rows[0]?.id_turno || null;

        // Insertar venta
        const queryVenta = `
            INSERT INTO venta_caja (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_venta;
        `;
        const resVenta = await client.query(queryVenta, [
            id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago
        ]);
        const id_venta = resVenta.rows[0].id_venta;

        // Procesar detalles y descontar inventario
        for (let item of detalles) {
            await client.query(
                `INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                 VALUES ($1, $2, $3, $4, $5)`,
                [id_venta, item.id_producto, item.cantidad, item.precio, item.subtotal]
            );

            const resInv = await client.query(
                `UPDATE inventario_sucursal 
                 SET cantidad_actual = cantidad_actual - $1 
                 WHERE id_sucursal = $2 AND id_producto = $3 
                 RETURNING id_inventario`,
                [item.cantidad, id_sucursal, item.id_producto]
            );

            if (resInv.rows.length > 0) {
                await client.query(
                    `INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                     VALUES ($1, $2, 'SALIDA', $3, 'Venta en Caja')`,
                    [resInv.rows[0].id_inventario, id_usuario_cajero, item.cantidad]
                );
            }
        }

        // Si viene de pedido QR, liberar mesa
        if (id_pedido_mesa) {
            await client.query(
                `UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1`,
                [id_pedido_mesa]
            );
            await client.query(
                `UPDATE mesa_local SET estado_mesa = 'Libre' 
                 WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)`,
                [id_pedido_mesa]
            );
        }

        await client.query('COMMIT');
        return id_venta;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const obtenerArqueo = async (id_sucursal, fecha_inicio, fecha_fin) => {
    const result = await db.query(`
        SELECT 
            COUNT(v.id_venta) AS total_ventas,
            COALESCE(SUM(v.monto_total_venta), 0) AS ingresos_totales,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'Efectivo' THEN v.monto_total_venta ELSE 0 END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN v.metodo_pago = 'QR' THEN v.monto_total_venta ELSE 0 END), 0) AS total_qr
        FROM venta_caja v
        WHERE v.id_sucursal = $1
          AND v.fecha_venta >= $2
          AND v.fecha_venta <= $3
    `, [id_sucursal, fecha_inicio, fecha_fin]);
    return result.rows[0];
};

module.exports = {
    obtenerEstadoCaja,
    habilitarCaja,
    deshabilitarCaja,
    abrirTurno,
    cerrarTurno,
    obtenerTurnoAbierto,
    registrarVenta,
    obtenerArqueo
};