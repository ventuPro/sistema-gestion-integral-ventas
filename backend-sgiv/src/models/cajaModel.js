const db = require('../config/db');

/*  ════════════════════════════════════════════════════════════════════
    REGLAS DE NEGOCIO DEL MÓDULO DE CAJA  (versión definitiva)
    ─────────────────────────────────────────────────────────────────────
    • La FUENTE DE VERDAD del estado de caja es turno_caja.estado_turno.
        - 'Abierto'  → el cajero PUEDE vender.
        - 'Cerrado'  → el cajero NO puede vender hasta que el admin
                       reabra el turno (o hasta nuevo día con apertura
                       automática).
    • usuario.caja_habilitada se mantiene SIEMPRE sincronizado:
        - TRUE  cuando hay un turno 'Abierto' para el cajero.
        - FALSE cuando no hay turno abierto.
      Se actualiza de forma automática en abrirTurno, cerrarCaja y
      reabrirTurno; nunca debe tocarse manualmente sin pasar por aquí.
    • Apertura automática diaria: si el cajero no tiene turno abierto
      hoy, el front llama a abrirTurno con el monto inicial — NO se
      necesita intervención del administrador.
    • Reapertura: si la caja del día ya fue cerrada, sólo el admin puede
      reabrir el último turno cerrado del día con reabrirTurno.
    ════════════════════════════════════════════════════════════════════ */


// ════════════════════════════════════════════════════════════════════
//  ESTADO DE CAJA (consultas)
// ════════════════════════════════════════════════════════════════════

// Devuelve true/false simple (legacy — sigue usado por algunos componentes)
const obtenerEstadoCaja = async (id_usuario) => {
    const r = await db.query(
        `SELECT caja_habilitada FROM usuario WHERE id_usuario = $1`,
        [id_usuario]
    );
    return r.rows[0] || { caja_habilitada: false };
};

// Estado COMPLETO del cajero (lo que usa el front para decidir todo)
const obtenerEstadoCompleto = async (id_usuario) => {
    // 1. Buscar turno abierto (puede haber máximo uno)
    const rAbierto = await db.query(`
        SELECT id_turno, fecha_hora_apertura, monto_inicial, estado_turno
        FROM turno_caja
        WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
        ORDER BY fecha_hora_apertura DESC
        LIMIT 1
    `, [id_usuario]);

    if (rAbierto.rows.length > 0) {
        // Sincronizar flag por si quedó desincronizado
        await db.query(
            `UPDATE usuario SET caja_habilitada = TRUE WHERE id_usuario = $1 AND caja_habilitada = FALSE`,
            [id_usuario]
        );
        return {
            estado:          'ABIERTA',
            caja_habilitada: true,
            tiene_turno_hoy: true,
            turno:           rAbierto.rows[0],
            puede_vender:    true
        };
    }

    // 2. No hay turno abierto → buscar último turno cerrado de HOY
    const rCerradoHoy = await db.query(`
        SELECT id_turno, fecha_hora_apertura, fecha_hora_cierre, monto_inicial, estado_turno
        FROM turno_caja
        WHERE id_usuario_cajero = $1
          AND estado_turno      = 'Cerrado'
          AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        ORDER BY fecha_hora_cierre DESC
        LIMIT 1
    `, [id_usuario]);

    // Sincronizar flag a FALSE — no hay turno abierto
    await db.query(
        `UPDATE usuario SET caja_habilitada = FALSE WHERE id_usuario = $1 AND caja_habilitada = TRUE`,
        [id_usuario]
    );

    if (rCerradoHoy.rows.length > 0) {
        return {
            estado:          'CERRADA',
            caja_habilitada: false,
            tiene_turno_hoy: true,        // ya abrió hoy pero está cerrada
            turno:           rCerradoHoy.rows[0],
            puede_vender:    false
        };
    }

    // 3. No tiene ningún turno hoy → primera apertura del día
    return {
        estado:          'SIN_APERTURA',
        caja_habilitada: false,
        tiene_turno_hoy: false,
        turno:           null,
        puede_vender:    false
    };
};


// ════════════════════════════════════════════════════════════════════
//  ABRIR / CERRAR / REABRIR TURNO
// ════════════════════════════════════════════════════════════════════

const abrirTurno = async (id_sucursal, id_usuario_cajero, monto_inicial) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Bloquear si ya tiene turno ABIERTO (sin filtro de fecha)
        const abierto = await client.query(
            `SELECT id_turno FROM turno_caja
             WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'`,
            [id_usuario_cajero]
        );
        if (abierto.rows.length > 0) {
            await client.query('ROLLBACK');
            throw new Error('YA_TIENE_TURNO_ABIERTO');
        }

        // Crear nuevo turno
        const r = await client.query(`
            INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
            VALUES ($1, $2, $3, 'Abierto')
            RETURNING *
        `, [id_sucursal, id_usuario_cajero, monto_inicial]);

        // Sincronizar flag → TRUE
        await client.query(
            `UPDATE usuario SET caja_habilitada = TRUE WHERE id_usuario = $1`,
            [id_usuario_cajero]
        );

        await client.query('COMMIT');
        return r.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const cerrarCaja = async (id_sucursal, id_usuario_cajero) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const r = await client.query(`
            UPDATE turno_caja
            SET fecha_hora_cierre = CURRENT_TIMESTAMP, estado_turno = 'Cerrado'
            WHERE id_usuario_cajero = $1
              AND id_sucursal       = $2
              AND estado_turno      = 'Abierto'
            RETURNING id_turno
        `, [id_usuario_cajero, id_sucursal]);

        // Sincronizar flag → FALSE
        await client.query(
            `UPDATE usuario SET caja_habilitada = FALSE WHERE id_usuario = $1`,
            [id_usuario_cajero]
        );

        await client.query('COMMIT');
        return {
            mensaje: 'Caja cerrada correctamente',
            id_turno_cerrado: r.rows[0]?.id_turno || null
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// Reabrir el último turno cerrado de HOY del cajero (solo admin)
const reabrirTurno = async (id_usuario_cajero) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Si ya tiene un turno abierto, no hace falta reabrir
        const abierto = await client.query(
            `SELECT id_turno FROM turno_caja
             WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'`,
            [id_usuario_cajero]
        );
        if (abierto.rows.length > 0) {
            await client.query('ROLLBACK');
            throw new Error('YA_TIENE_TURNO_ABIERTO');
        }

        // Buscar último turno cerrado de HOY
        const rUlt = await client.query(`
            SELECT id_turno FROM turno_caja
            WHERE id_usuario_cajero = $1
              AND estado_turno      = 'Cerrado'
              AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
            ORDER BY fecha_hora_cierre DESC
            LIMIT 1
        `, [id_usuario_cajero]);

        if (rUlt.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('NO_HAY_TURNO_CERRADO_HOY');
        }

        const id_turno = rUlt.rows[0].id_turno;

        // Reabrir: vuelve a 'Abierto' y limpia fecha de cierre
        const r = await client.query(`
            UPDATE turno_caja
            SET estado_turno = 'Abierto',
                fecha_hora_cierre = NULL
            WHERE id_turno = $1
            RETURNING *
        `, [id_turno]);

        // Sincronizar flag → TRUE
        await client.query(
            `UPDATE usuario SET caja_habilitada = TRUE WHERE id_usuario = $1`,
            [id_usuario_cajero]
        );

        await client.query('COMMIT');
        return r.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};


// ════════════════════════════════════════════════════════════════════
//  HABILITAR / DESHABILITAR (admin desde módulo Usuarios)
// ════════════════════════════════════════════════════════════════════

// Para el admin: "Reabrir caja" desde Usuarios.
// Si el cajero tiene un turno cerrado hoy → reabre.
// Si no tiene turno hoy → solo habilita el flag.
const habilitarCaja = async (id_usuario) => {
    // Si tiene turno cerrado hoy → reabrir
    const rCerradoHoy = await db.query(`
        SELECT id_turno FROM turno_caja
        WHERE id_usuario_cajero = $1
          AND estado_turno      = 'Cerrado'
          AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        ORDER BY fecha_hora_cierre DESC LIMIT 1
    `, [id_usuario]);

    if (rCerradoHoy.rows.length > 0) {
        await reabrirTurno(id_usuario);
        const r = await db.query(
            `SELECT id_usuario, nombre_completo, caja_habilitada FROM usuario WHERE id_usuario = $1`,
            [id_usuario]
        );
        return { ...r.rows[0], accion: 'TURNO_REABIERTO' };
    }

    // Sin turno cerrado hoy → solo flag (el cajero abrirá su turno normalmente)
    const r = await db.query(
        `UPDATE usuario SET caja_habilitada = TRUE WHERE id_usuario = $1
         RETURNING id_usuario, nombre_completo, caja_habilitada`,
        [id_usuario]
    );
    return { ...r.rows[0], accion: 'FLAG_HABILITADO' };
};

// Para el admin: "Cerrar caja" desde Usuarios.
const deshabilitarCaja = async (id_usuario) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const rUser = await client.query(
            `SELECT id_sucursal FROM usuario WHERE id_usuario = $1`,
            [id_usuario]
        );
        if (rUser.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const id_sucursal = rUser.rows[0].id_sucursal;

        await client.query(`
            UPDATE turno_caja
            SET fecha_hora_cierre = CURRENT_TIMESTAMP, estado_turno = 'Cerrado'
            WHERE id_usuario_cajero = $1
              AND id_sucursal       = $2
              AND estado_turno      = 'Abierto'
        `, [id_usuario, id_sucursal]);

        const r = await client.query(
            `UPDATE usuario SET caja_habilitada = FALSE WHERE id_usuario = $1
             RETURNING id_usuario, nombre_completo, caja_habilitada`,
            [id_usuario]
        );

        await client.query('COMMIT');
        return r.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};


// ════════════════════════════════════════════════════════════════════
//  CONSULTAS DE ARQUEO / VENTAS
// ════════════════════════════════════════════════════════════════════

const obtenerArqueoHoy = async (id_sucursal, id_usuario_cajero) => {
    const resumen = await db.query(`
        SELECT
            COUNT(id_venta)::int                                                           AS total_ventas,
            COALESCE(SUM(monto_total_venta), 0)                                            AS ingresos_totales,
            COALESCE(SUM(CASE WHEN metodo_pago = 'Efectivo' THEN monto_total_venta END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago = 'QR'       THEN monto_total_venta END), 0) AS total_qr
        FROM venta_caja
        WHERE id_sucursal       = $1
          AND id_usuario_cajero = $2
          AND DATE(fecha_venta AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
    `, [id_sucursal, id_usuario_cajero]);

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

    // Turno activo (abierto). Si no hay, devolver último de hoy con su estado.
    const turnoActivo = await db.query(`
        SELECT id_turno, monto_inicial, fecha_hora_apertura, fecha_hora_cierre, estado_turno
        FROM turno_caja
        WHERE id_usuario_cajero = $2
          AND id_sucursal       = $1
          AND estado_turno      = 'Abierto'
        ORDER BY fecha_hora_apertura DESC
        LIMIT 1
    `, [id_sucursal, id_usuario_cajero]);

    let turnoFinal = turnoActivo.rows[0] || null;
    if (!turnoFinal) {
        const ultimoHoy = await db.query(`
            SELECT id_turno, monto_inicial, fecha_hora_apertura, fecha_hora_cierre, estado_turno
            FROM turno_caja
            WHERE id_usuario_cajero = $2
              AND id_sucursal       = $1
              AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
            ORDER BY fecha_hora_apertura DESC
            LIMIT 1
        `, [id_sucursal, id_usuario_cajero]);
        turnoFinal = ultimoHoy.rows[0] || null;
    }

    return {
        resumen:      resumen.rows[0],
        ventas:       ventas.rows,
        turno_activo: turnoFinal
    };
};

const obtenerVentasHoyPOS = async (id_sucursal, id_usuario_cajero) => {
    const resVentas = await db.query(`
        SELECT
            v.id_venta,
            v.monto_total_venta,
            v.metodo_pago,
            v.fecha_venta
        FROM venta_caja v
        WHERE v.id_sucursal       = $1
          AND v.id_usuario_cajero = $2
          AND DATE(v.fecha_venta AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        ORDER BY v.fecha_venta DESC
        LIMIT 30
    `, [id_sucursal, id_usuario_cajero]);

    if (resVentas.rows.length === 0) return [];

    const ids = resVentas.rows.map(v => v.id_venta);

    const resDetalle = await db.query(`
        SELECT
            dv.id_venta,
            p.nombre_producto,
            dv.cantidad_vendida,
            dv.precio_unitario,
            dv.subtotal_venta
        FROM detalle_venta dv
        JOIN producto p ON dv.id_producto = p.id_producto
        WHERE dv.id_venta = ANY($1::int[])
        ORDER BY dv.id_venta, p.nombre_producto
    `, [ids]);

    const detalleMap = {};
    resDetalle.rows.forEach(d => {
        if (!detalleMap[d.id_venta]) detalleMap[d.id_venta] = [];
        detalleMap[d.id_venta].push(d);
    });

    return resVentas.rows.map(v => ({
        ...v,
        items: detalleMap[v.id_venta] || []
    }));
};


// ════════════════════════════════════════════════════════════════════
//  REGISTRO DE VENTA  (con validación estricta de turno)
// ════════════════════════════════════════════════════════════════════

const registrarVenta = async ({
    id_sucursal, id_usuario_cajero, id_cliente,
    id_pedido_mesa, monto_total_venta, metodo_pago, detalles
}) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. VALIDACIÓN OBLIGATORIA: el cajero debe tener turno abierto
        const rTurno = await client.query(`
            SELECT id_turno FROM turno_caja
            WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
            ORDER BY fecha_hora_apertura DESC LIMIT 1
        `, [id_usuario_cajero]);

        if (rTurno.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('CAJA_CERRADA');
        }
        const id_turno = rTurno.rows[0].id_turno;

        // 2. Registrar la venta principal
        const rVenta = await client.query(`
            INSERT INTO venta_caja
                (id_sucursal, id_usuario_cajero, id_cliente, id_pedido_mesa,
                 id_turno, monto_total_venta, metodo_pago)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id_venta
        `, [
            Number(id_sucursal),
            Number(id_usuario_cajero),
            id_cliente    || null,
            id_pedido_mesa|| null,
            id_turno,
            Number(monto_total_venta),
            metodo_pago
        ]);
        const id_venta = rVenta.rows[0].id_venta;

        // 3. Procesar cada ítem del carrito
        for (const item of detalles) {
            const cantidad = Number(item.cantidad) || 1;
            const precio   = Number(item.precio)   || 0;
            const subtotal = Number(item.subtotal) || (cantidad * precio);
            const id_prod  = Number(item.id_producto);

            await client.query(`
                INSERT INTO detalle_venta
                    (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta)
                VALUES ($1, $2, $3, $4, $5)
            `, [id_venta, id_prod, cantidad, precio, subtotal]);

            const rInv = await client.query(`
                UPDATE inventario_sucursal
                SET cantidad_actual = GREATEST(0, cantidad_actual - $1)
                WHERE id_sucursal = $2 AND id_producto = $3
                RETURNING id_inventario, cantidad_actual
            `, [cantidad, Number(id_sucursal), id_prod]);

            if (rInv.rows.length > 0) {
                await client.query(`
                    INSERT INTO historial_inventario
                        (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
                    VALUES ($1, $2, 'SALIDA', $3, 'Venta en Caja')
                `, [rInv.rows[0].id_inventario, Number(id_usuario_cajero), cantidad]);
            }
        }

        // 4. Si viene de pedido QR → liberar mesa
        if (id_pedido_mesa) {
            await client.query(
                `UPDATE pedido_mesa SET estado_pedido = 'Pagado' WHERE id_pedido = $1`,
                [id_pedido_mesa]
            );
            await client.query(`
                UPDATE mesa_local SET estado_mesa = 'Libre'
                WHERE id_mesa = (SELECT id_mesa FROM pedido_mesa WHERE id_pedido = $1)
            `, [id_pedido_mesa]);
        }

        await client.query('COMMIT');
        return id_venta;

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('registrarVenta ROLLBACK:', e.message);
        throw e;
    } finally {
        client.release();
    }
};


// ════════════════════════════════════════════════════════════════════
//  CIERRES (admin)
// ════════════════════════════════════════════════════════════════════

const obtenerCierresCaja = async () => {
    const result = await db.query(`
        SELECT
            t.id_turno,
            t.fecha_hora_apertura,
            t.fecha_hora_cierre,
            t.monto_inicial,
            u.nombre_completo            AS nombre_cajero,
            s.nombre_sucursal,
            COUNT(v.id_venta)::int       AS total_ventas,
            COALESCE(SUM(v.monto_total_venta), 0)                                             AS total_recaudado,
            COALESCE(SUM(CASE WHEN v.metodo_pago='Efectivo' THEN v.monto_total_venta END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN v.metodo_pago='QR'       THEN v.monto_total_venta END), 0) AS total_qr
        FROM turno_caja t
        JOIN usuario  u ON t.id_usuario_cajero = u.id_usuario
        JOIN sucursal s ON t.id_sucursal       = s.id_sucursal
        LEFT JOIN venta_caja v ON v.id_turno = t.id_turno
        WHERE t.estado_turno = 'Cerrado'
        GROUP BY t.id_turno, t.fecha_hora_apertura, t.fecha_hora_cierre,
                 t.monto_inicial, u.nombre_completo, s.nombre_sucursal
        ORDER BY t.fecha_hora_cierre DESC
    `);
    return result.rows;
};

// Compat: verificar último turno abierto del cajero (legacy)
const verificarTurnoHoy = async (id_usuario_cajero) => {
    const r = await db.query(`
        SELECT id_turno, estado_turno, fecha_hora_apertura, monto_inicial
        FROM turno_caja
        WHERE id_usuario_cajero = $1
          AND estado_turno      = 'Abierto'
        ORDER BY fecha_hora_apertura DESC
        LIMIT 1
    `, [id_usuario_cajero]);
    return r.rows[0] || null;
};

const obtenerEstadoCajaSucursal = async (id_sucursal) => {
    const r = await db.query(`
        SELECT
            COUNT(DISTINCT t.id_usuario_cajero)::int AS cajeros_con_turno,
            EXISTS(
                SELECT 1 FROM turno_caja t2
                JOIN usuario u2 ON t2.id_usuario_cajero = u2.id_usuario
                WHERE u2.id_sucursal = $1 AND t2.estado_turno = 'Abierto'
            ) AS hay_caja_abierta
        FROM turno_caja t
        JOIN usuario u ON t.id_usuario_cajero = u.id_usuario
        WHERE u.id_sucursal = $1 AND t.estado_turno = 'Abierto'
    `, [id_sucursal]);
    return r.rows[0];
};

module.exports = {
    obtenerEstadoCaja,
    obtenerEstadoCompleto,
    habilitarCaja, deshabilitarCaja,
    obtenerArqueoHoy, obtenerVentasHoyPOS,
    abrirTurno, cerrarCaja, reabrirTurno, registrarVenta,
    obtenerCierresCaja,
    verificarTurnoHoy,
    obtenerEstadoCajaSucursal
};
