const db = require('../config/db');

// ─── CONTROL DE CAJA ───
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

// ─── ARQUEO COMPLETO DEL DÍA ───
const obtenerArqueoHoy = async (id_sucursal, id_usuario_cajero) => {
    // Resumen del día
    const resumen = await db.query(`
        SELECT 
            COUNT(id_venta)::int                                                          AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0)                                           AS ingresos_totales,
            COALESCE(SUM(CASE WHEN metodo_pago = 'Efectivo' THEN monto_total_venta END),0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago = 'QR'       THEN monto_total_venta END),0) AS total_qr
        FROM venta_caja
        WHERE id_sucursal       = $1
          AND id_usuario_cajero = $2
          AND DATE(fecha_venta AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
    `, [id_sucursal, id_usuario_cajero]);

    // Detalle de ventas del día
    const ventas = await db.query(`
        SELECT 
            v.id_venta,
            v.monto_total_venta,
            v.metodo_pago,
            v.fecha_venta,
            COUNT(dv.id_detalle_venta)::int AS num_items
        FROM venta_caja v
        LEFT JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        WHERE v.id_sucursal       = $1
          AND v.id_usuario_cajero = $2
          AND DATE(v.fecha_venta AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        GROUP BY v.id_venta, v.monto_total_venta, v.metodo_pago, v.fecha_venta
        ORDER BY v.fecha_venta DESC
    `, [id_sucursal, id_usuario_cajero]);

    // Turno activo del cajero
    const turno = await db.query(`
        SELECT id_turno, monto_inicial, fecha_hora_apertura
        FROM turno_caja
        WHERE id_usuario_cajero = $2
          AND id_sucursal       = $1
          AND estado_turno      = 'Abierto'
        ORDER BY fecha_hora_apertura DESC
        LIMIT 1
    `, [id_sucursal, id_usuario_cajero]);

    return {
        resumen:      resumen.rows[0],
        ventas:       ventas.rows,
        turno_activo: turno.rows[0] || null
    };
};

// ─── VENTAS HOY PARA PANEL POS ───
const obtenerVentasHoyPOS = async (id_sucursal, id_usuario_cajero) => {
    const result = await db.query(`
        SELECT 
            v.id_venta,
            v.monto_total_venta,
            v.metodo_pago,
            v.fecha_venta,
            ARRAY_AGG(p.nombre_producto) AS productos
        FROM venta_caja v
        JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        JOIN producto p       ON dv.id_producto = p.id_producto
        WHERE v.id_sucursal       = $1
          AND v.id_usuario_cajero = $2
          AND DATE(v.fecha_venta AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        GROUP BY v.id_venta, v.monto_total_venta, v.metodo_pago, v.fecha_venta
        ORDER BY v.fecha_venta DESC
        LIMIT 20
    `, [id_sucursal, id_usuario_cajero]);
    return result.rows;
};

// ─── TURNOS ───
const abrirTurno = async (id_sucursal, id_usuario_cajero, monto_inicial) => {
    const check = await db.query(
        `SELECT caja_habilitada FROM usuario WHERE id_usuario = $1`,
        [id_usuario_cajero]
    );
    if (!check.rows[0]?.caja_habilitada) throw new Error('CAJA_NO_HABILITADA');

    const turnoAbierto = await db.query(
        `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero=$1 AND estado_turno='Abierto'`,
        [id_usuario_cajero]
    );
    if (turnoAbierto.rows.length > 0) throw new Error('YA_TIENE_TURNO_ABIERTO');

    const result = await db.query(`
        INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
        VALUES ($1, $2, $3, 'Abierto') RETURNING *
    `, [id_sucursal, id_usuario_cajero, monto_inicial]);
    return result.rows[0];
};

const cerrarCaja = async (id_sucursal, id_usuario_cajero) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Cerrar turno abierto si existe
        const resTurno = await client.query(`
            UPDATE turno_caja
            SET fecha_hora_cierre  = CURRENT_TIMESTAMP,
                estado_turno       = 'Cerrado'
            WHERE id_usuario_cajero = $1
              AND id_sucursal       = $2
              AND estado_turno      = 'Abierto'
            RETURNING *
        `, [id_usuario_cajero, id_sucursal]);

        // Deshabilitar caja
        await client.query(
            `UPDATE usuario SET caja_habilitada = FALSE WHERE id_usuario = $1`,
            [id_usuario_cajero]
        );

        await client.query('COMMIT');
        return { turno_cerrado: resTurno.rows[0] || null, mensaje: 'Caja cerrada correctamente' };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// ─── REGISTRO DE VENTA ───
const registrarVenta = async (datosVenta) => {
    const { id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, monto_total_venta, metodo_pago, detalles } = datosVenta;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Buscar turno abierto (opcional)
        const resTurno = await client.query(`
            SELECT id_turno FROM turno_caja
            WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
            ORDER BY fecha_hora_apertura DESC LIMIT 1
        `, [id_usuario_cajero]);
        const id_turno = resTurno.rows[0]?.id_turno || null;

        const resVenta = await client.query(`
            INSERT INTO venta_caja 
                (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_venta
        `, [id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa, id_turno, monto_total_venta, metodo_pago]);
        const id_venta = resVenta.rows[0].id_venta;

        for (const item of detalles) {
            await client.query(`
                INSERT INTO detalle_venta (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                VALUES ($1,$2,$3,$4,$5)
            `, [id_venta, item.id_producto, item.cantidad, item.precio, item.subtotal]);

            const resInv = await client.query(`
                UPDATE inventario_sucursal
                SET cantidad_actual = cantidad_actual - $1
                WHERE id_sucursal=$2 AND id_producto=$3
                RETURNING id_inventario
            `, [item.cantidad, id_sucursal, item.id_producto]);

            if (resInv.rows.length > 0) {
                await client.query(`
                    INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                    VALUES ($1,$2,'SALIDA',$3,'Venta en Caja')
                `, [resInv.rows[0].id_inventario, id_usuario_cajero, item.cantidad]);
            }
        }

        if (id_pedido_mesa) {
            await client.query(
                `UPDATE pedido_mesa SET estado_pedido='Pagado' WHERE id_pedido=$1`, [id_pedido_mesa]
            );
            await client.query(`
                UPDATE mesa_local SET estado_mesa='Libre'
                WHERE id_mesa=(SELECT id_mesa FROM pedido_mesa WHERE id_pedido=$1)
            `, [id_pedido_mesa]);
        }

        await client.query('COMMIT');
        return id_venta;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = {
    obtenerEstadoCaja, habilitarCaja, deshabilitarCaja,
    obtenerArqueoHoy, obtenerVentasHoyPOS,
    abrirTurno, cerrarCaja, registrarVenta
};