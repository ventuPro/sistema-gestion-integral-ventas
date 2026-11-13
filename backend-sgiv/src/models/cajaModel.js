const db = require('../config/db');
const { moverStock } = require('./inventarioModel');
const { costoActual, costoDeLotes, costoReservado } = require('./loteModel');
const reservaModel = require('./reservaModel');
const { METODO_PAGO } = require('../utils/metodosPago');
const promocionModel = require('./promocionModel');
const notificacionModel = require('./notificacionModel');
const { siguienteNumero } = require('../utils/numeroDia');

// Efectivo esperado de un turno t: fondo inicial + ventas en efectivo (igual en todo cierre)
const EFECTIVO_ESPERADO = `t.monto_inicial + COALESCE((
    SELECT SUM(v.monto_total_venta) FROM venta_caja v
    WHERE v.id_turno = t.id_turno AND v.metodo_pago = '${METODO_PAGO.efectivo}'), 0)`;

// ─── Turno con el que se vende ───
// Abierto y de hoy (si quedó uno de ayer, el cierre automático lo cierra en menos de un minuto).
// FOR SHARE: un cierre de caja espera a que termine la venta, y la venta que llega
// mientras se cierra ve el turno ya cerrado.
const turnoParaVender = async (client, id_usuario) => (await client.query(`
    SELECT id_turno, id_sucursal FROM turno_caja
    WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto' AND fecha_hora_apertura >= CURRENT_DATE
    ORDER BY fecha_hora_apertura DESC LIMIT 1
    FOR SHARE
`, [id_usuario])).rows[0] || null;

// Caja habilitada = el usuario tiene un turno abierto (no se guarda aparte)
const CAJA_ABIERTA = `EXISTS (SELECT 1 FROM turno_caja t WHERE t.id_usuario_cajero = u.id_usuario AND t.estado_turno = 'Abierto')`;

const obtenerEstadoCaja = async (id_usuario) => {
    const r = await db.query(`SELECT ${CAJA_ABIERTA} AS caja_habilitada FROM usuario u WHERE u.id_usuario = $1`, [id_usuario]);
    return r.rows[0] || { caja_habilitada: false };
};

const obtenerEstadoCompleto = async (id_usuario) => {
    const rAbierto = await db.query(`
        SELECT id_turno, id_sucursal, fecha_hora_apertura, monto_inicial, estado_turno
        FROM turno_caja
        WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto'
        ORDER BY fecha_hora_apertura DESC
        LIMIT 1
    `, [id_usuario]);

    if (rAbierto.rows.length > 0) {
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
        SELECT id_turno, id_sucursal, fecha_hora_apertura, fecha_hora_cierre, monto_inicial, estado_turno
        FROM turno_caja
        WHERE id_usuario_cajero = $1
          AND estado_turno      = 'Cerrado'
          AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
        ORDER BY fecha_hora_cierre DESC
        LIMIT 1
    `, [id_usuario]);

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
    // Si su turno anterior lo cerró el sistema a las 00:00, se le avisa
    const rSistema = await db.query(`
        SELECT id_turno, fecha_hora_apertura, fecha_hora_cierre FROM turno_caja
        WHERE id_usuario_cajero = $1 AND cerrado_por = 'Sistema' AND fecha_hora_cierre >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY fecha_hora_cierre DESC LIMIT 1
    `, [id_usuario]);
    return {
        estado:          'SIN_APERTURA',
        caja_habilitada: false,
        tiene_turno_hoy: false,
        turno:           null,
        puede_vender:    false,
        cierre_sistema:  rSistema.rows[0] || null
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

        // Crear nuevo turno (uq_turno_abierto_cajero evita dos a la vez)
        const r = await client.query(`
            INSERT INTO turno_caja (id_sucursal, id_usuario_cajero, monto_inicial, estado_turno)
            VALUES ($1, $2, $3, 'Abierto')
            RETURNING *
        `, [id_sucursal, id_usuario_cajero, monto_inicial]).catch(e => {
            throw e.code === '23505' ? new Error('YA_TIENE_TURNO_ABIERTO') : e;
        });

        await client.query('COMMIT');
        return r.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// efectivo_contado (opcional): lo que el cajero contó en caja; se guarda con la diferencia
const cerrarCaja = async (id_sucursal, id_usuario_cajero, efectivo_contado = null) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Primero se bloquea el turno (espera a las ventas en curso); luego se suma con lo ya confirmado
        const rT = await client.query(
            `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto' FOR UPDATE`,
            [id_usuario_cajero]);
        const r = await client.query(`
            UPDATE turno_caja t
            SET fecha_hora_cierre = CURRENT_TIMESTAMP, estado_turno = 'Cerrado', cerrado_por = 'Cajero',
                monto_calculado = ${EFECTIVO_ESPERADO},
                monto_real_declarado = $2::numeric
            WHERE t.id_turno = ANY($1::int[]) AND t.estado_turno = 'Abierto'
            RETURNING t.id_turno, t.monto_calculado::float8, t.monto_real_declarado::float8, t.diferencia::float8
        `, [rT.rows.map(t => t.id_turno), efectivo_contado]);
        if (r.rows[0]) await notificacionModel.arqueoConDiferencia(client, r.rows[0].id_turno);

        await client.query('COMMIT');
        const t = r.rows[0];
        return {
            mensaje: 'Caja cerrada correctamente',
            id_turno_cerrado: t?.id_turno || null,
            efectivo_esperado: t?.monto_calculado ?? null,
            efectivo_contado:  t?.monto_real_declarado ?? null,
            diferencia:        t?.diferencia ?? null
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

        // Reabrir: vuelve a 'Abierto' y limpia el cierre anterior (se recalcula al cerrar de nuevo)
        const r = await client.query(`
            UPDATE turno_caja
            SET estado_turno = 'Abierto',
                fecha_hora_cierre = NULL, cerrado_por = NULL,
                monto_calculado = NULL, monto_real_declarado = NULL
            WHERE id_turno = $1
            RETURNING *
        `, [id_turno]).catch(e => {
            throw e.code === '23505' ? new Error('YA_TIENE_TURNO_ABIERTO') : e;
        });

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
// Si el cajero tiene un turno cerrado hoy → reabre. Si no tiene turno hoy, el cajero abre su caja normalmente.
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
        return { ...(await datosCaja(id_usuario)), accion: 'TURNO_REABIERTO' };
    }
    return { ...(await datosCaja(id_usuario)), accion: 'FLAG_HABILITADO' };
};

const datosCaja = async (id_usuario, cliente = db) => (await cliente.query(
    `SELECT u.id_usuario, u.nombre_completo, ${CAJA_ABIERTA} AS caja_habilitada FROM usuario u WHERE u.id_usuario = $1`,
    [id_usuario])).rows[0];

// Para el admin: "Cerrar caja" desde Usuarios.
const deshabilitarCaja = async (id_usuario) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const rUser = await client.query(
            `SELECT id_usuario FROM usuario WHERE id_usuario = $1`,
            [id_usuario]
        );
        if (rUser.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        // Cierra el turno abierto aunque se haya abierto en otra sucursal, con el mismo
        // efectivo esperado que el cierre del cajero (sin conteo)
        const rT = await client.query(
            `SELECT id_turno FROM turno_caja WHERE id_usuario_cajero = $1 AND estado_turno = 'Abierto' FOR UPDATE`,
            [id_usuario]);
        const turnos = (await client.query(`
            UPDATE turno_caja t
            SET fecha_hora_cierre = CURRENT_TIMESTAMP, estado_turno = 'Cerrado', cerrado_por = 'Administrador',
                monto_calculado = ${EFECTIVO_ESPERADO}
            WHERE t.id_turno = ANY($1::int[]) AND t.estado_turno = 'Abierto'
            RETURNING t.id_turno, t.id_sucursal
        `, [rT.rows.map(t => t.id_turno)])).rows;

        const usuario = await datosCaja(id_usuario, client);
        await client.query('COMMIT');
        return { ...usuario, turnos };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};


// ─── Cierre automático: los turnos abiertos de un día anterior se cierran a las 00:00 ───
// La hora de cierre es la medianoche de su día (aunque el proceso corra después, p. ej. si el
// servidor estuvo apagado). Sin conteo de efectivo: queda «sin conteo» con lo esperado.
const cerrarTurnosVencidos = async () => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const r = await client.query(`
            UPDATE turno_caja t
            SET estado_turno = 'Cerrado', cerrado_por = 'Sistema',
                fecha_hora_cierre = date_trunc('day', t.fecha_hora_apertura) + INTERVAL '1 day',
                monto_calculado = ${EFECTIVO_ESPERADO}
            WHERE t.estado_turno = 'Abierto' AND t.fecha_hora_apertura < CURRENT_DATE
            RETURNING t.id_turno, t.id_usuario_cajero, t.id_sucursal
        `);
        for (const t of r.rows) await notificacionModel.cajaSinCerrar(client, t.id_turno);
        await client.query('COMMIT');
        return r.rows;
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
            COALESCE(SUM(CASE WHEN metodo_pago = '${METODO_PAGO.efectivo}' THEN monto_total_venta END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN metodo_pago = '${METODO_PAGO.qr}' THEN monto_total_venta END), 0) AS total_qr
        FROM venta_caja
        WHERE id_sucursal       = $1
          AND id_usuario_cajero = $2
          AND fecha_venta >= CURRENT_DATE AND fecha_venta < CURRENT_DATE + 1
    `, [id_sucursal, id_usuario_cajero]);

    const ventas = await db.query(`
        SELECT
            v.id_venta,
            v.numero_dia,
            v.monto_total_venta,
            v.metodo_pago,
            v.fecha_venta,
            COUNT(dv.id_detalle_venta)::int AS num_items
        FROM venta_caja v
        LEFT JOIN detalle_venta dv ON v.id_venta = dv.id_venta
        WHERE v.id_sucursal       = $1
          AND v.id_usuario_cajero = $2
          AND v.fecha_venta >= CURRENT_DATE AND v.fecha_venta < CURRENT_DATE + 1
        GROUP BY v.id_venta, v.monto_total_venta, v.metodo_pago, v.fecha_venta
        ORDER BY v.fecha_venta DESC
    `, [id_sucursal, id_usuario_cajero]);

    // Turno activo (abierto). Si no hay, devolver último de hoy con su estado.
    const turnoActivo = await db.query(`
        SELECT id_turno, monto_inicial, fecha_hora_apertura, fecha_hora_cierre, estado_turno,
               monto_real_declarado::float8 AS efectivo_contado, diferencia::float8 AS diferencia
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
            SELECT id_turno, monto_inicial, fecha_hora_apertura, fecha_hora_cierre, estado_turno,
               monto_real_declarado::float8 AS efectivo_contado, diferencia::float8 AS diferencia
            FROM turno_caja
            WHERE id_usuario_cajero = $2
              AND id_sucursal       = $1
              AND DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz') = CURRENT_DATE
            ORDER BY fecha_hora_apertura DESC
            LIMIT 1
        `, [id_sucursal, id_usuario_cajero]);
        turnoFinal = ultimoHoy.rows[0] || null;
    }

    // Lo que corresponde al turno (puede abarcar más de un día): base del arqueo
    let turnoResumen = null;
    if (turnoFinal) {
        // Sumas en NUMERIC (sin redondeos de JavaScript); se convierten solo para enviarlas
        const [m, t] = await Promise.all([
            db.query(`
                SELECT metodo_pago, COUNT(*)::int AS ventas, SUM(monto_total_venta)::float8 AS total
                FROM venta_caja WHERE id_turno = $1
                GROUP BY metodo_pago ORDER BY SUM(monto_total_venta) DESC
            `, [turnoFinal.id_turno]),
            db.query(`
                SELECT COUNT(v.id_venta)::int AS ventas,
                       COALESCE(SUM(v.monto_total_venta), 0)::float8 AS total,
                       COALESCE(SUM(v.monto_total_venta) FILTER (WHERE v.metodo_pago = '${METODO_PAGO.efectivo}'), 0)::float8 AS efectivo,
                       (${EFECTIVO_ESPERADO})::float8 AS efectivo_esperado
                FROM turno_caja t LEFT JOIN venta_caja v ON v.id_turno = t.id_turno
                WHERE t.id_turno = $1
                GROUP BY t.id_turno
            `, [turnoFinal.id_turno])
        ]);
        turnoResumen = { metodos: m.rows, ...t.rows[0] };
    }

    return {
        resumen:       resumen.rows[0],
        ventas:        ventas.rows,
        turno_activo:  turnoFinal,
        turno_resumen: turnoResumen
    };
};

// ─── Comprobante de una venta ya registrada (reimpresión) ───
// id_sucursal: si viene, la venta debe ser de esa sucursal (cajero). Devuelve null si no existe.
const obtenerComprobante = async (id_venta, id_sucursal = null) => {
    const venta = await db.query(`
        SELECT v.id_venta, v.numero_dia, v.id_sucursal, v.fecha_venta, v.monto_total_venta, v.metodo_pago,
               v.descuento_promociones, v.descuento_manual, v.motivo_descuento,
               mesa.numero_mesa, mesa.clientes
        FROM venta_caja v
        LEFT JOIN LATERAL (
            SELECT MIN(m.numero_mesa) AS numero_mesa,
                   ARRAY_REMOVE(ARRAY_AGG(DISTINCT pq.nombre_cliente), NULL) AS clientes
            FROM detalle_cuenta dc
            LEFT JOIN pedido_mesa pq ON pq.id_pedido = dc.id_pedido
            JOIN cuenta_mesa c ON c.id_cuenta = dc.id_cuenta
            JOIN mesa_local m  ON m.id_mesa   = c.id_mesa
            WHERE dc.id_venta = v.id_venta
        ) mesa ON TRUE
        WHERE v.id_venta = $1 AND ($2::int IS NULL OR v.id_sucursal = $2)
    `, [id_venta, id_sucursal]);
    const v = venta.rows[0];
    if (!v) return null;

    const lineas = await db.query(`
        SELECT p.nombre_producto, dv.cantidad_vendida, dv.precio_unitario, dv.descuento_promocion, pr.nombre AS promocion
        FROM detalle_venta dv
        JOIN producto p        ON p.id_producto   = dv.id_producto
        LEFT JOIN promocion pr ON pr.id_promocion = dv.id_promocion
        WHERE dv.id_venta = $1
        ORDER BY dv.id_detalle_venta
    `, [id_venta]);

    return {
        id_venta: v.id_venta,
        numero_dia: v.numero_dia,
        fecha_venta: v.fecha_venta,
        items: lineas.rows.map(l => ({
            nombre_producto: l.nombre_producto,
            cantidad:        l.cantidad_vendida,
            precio_unitario: Number(l.precio_unitario),
            subtotal:        Number(l.precio_unitario) * l.cantidad_vendida,
            descuento:       Number(l.descuento_promocion) || 0,
            promocion:       l.promocion || undefined
        })),
        total:                 Number(v.monto_total_venta),
        descuento_promociones: Number(v.descuento_promociones) || 0,
        descuento_manual:      Number(v.descuento_manual) || 0,
        motivo_descuento:      v.motivo_descuento,
        metodo:                v.metodo_pago,
        numero_mesa:           v.numero_mesa || undefined,
        cliente:               v.clientes?.length === 1 ? v.clientes[0] : undefined
    };
};

const obtenerVentasHoyPOS = async (id_sucursal, id_usuario_cajero) => {
    const resVentas = await db.query(`
        SELECT
            v.id_venta,
            v.numero_dia,
            v.monto_total_venta,
            v.metodo_pago,
            v.fecha_venta
        FROM venta_caja v
        WHERE v.id_sucursal       = $1
          AND v.id_usuario_cajero = $2
          AND v.fecha_venta >= CURRENT_DATE AND v.fecha_venta < CURRENT_DATE + 1
        ORDER BY v.fecha_venta DESC
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

// Valida el carrito y le pone el precio vigente de la BD a cada ítem.
// Lanza VENTA_INVALIDA si el carrito está vacío, una cantidad no es un entero
// positivo o un producto no existe / está inactivo.
const calcularItemsVenta = async (client, detalles) => {
    const invalida = (msg) => { const e = new Error(msg); e.code = 'VENTA_INVALIDA'; return e; };
    if (!Array.isArray(detalles) || detalles.length === 0) throw invalida('El carrito está vacío.');

    const ids = [...new Set(detalles.map(d => Number(d.id_producto)))];
    const r = await client.query(
        `SELECT id_producto, id_categoria, nombre_producto, precio_unitario, estado_activo
         FROM producto WHERE id_producto = ANY($1::int[])`,
        [ids.filter(Number.isInteger)]
    );
    const precios = new Map(r.rows.map(p => [Number(p.id_producto), p]));

    return detalles.map(d => {
        const id_producto = Number(d.id_producto);
        const cantidad    = Number(d.cantidad);
        const prod = precios.get(id_producto);
        if (!prod) throw invalida('Un producto del carrito ya no existe.');
        if (!prod.estado_activo) throw invalida(`«${prod.nombre_producto}» ya no está a la venta.`);
        if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 100000)
            throw invalida(`Cantidad inválida de «${prod.nombre_producto}».`);
        const precioCentavos = Math.round(Number(prod.precio_unitario) * 100);
        return {
            id_producto, cantidad,
            id_categoria:     Number(prod.id_categoria),
            precio:           precioCentavos / 100,
            subtotalCentavos: precioCentavos * cantidad
        };
    });
};

// descuento: { tipo, valor, motivo } opcional
const registrarVenta = async ({
    id_sucursal, id_usuario_cajero, monto_total_venta, metodo_pago, detalles,
    descuento = null
}) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. VALIDACIÓN OBLIGATORIA: el cajero debe tener turno abierto.
        //    La venta y el stock son siempre de la sucursal del turno (no de lo que diga la pantalla).
        const turno = await turnoParaVender(client, id_usuario_cajero);
        if (!turno) throw new Error('CAJA_CERRADA');
        const id_turno = turno.id_turno;
        id_sucursal = turno.id_sucursal;

        // 2. Precios, promociones y total se calculan con la BD; del cliente solo se toman
        //    producto, cantidad y el descuento manual. Si el total que vio el cajero no
        //    coincide (precio o promoción cambió mientras tenía el carrito), se rechaza.
        const items = await calcularItemsVenta(client, detalles);
        const cot = await promocionModel.cotizar(client, {
            id_sucursal: Number(id_sucursal),
            lineas: items.map(i => ({ id_producto: i.id_producto, id_categoria: i.id_categoria,
                                      cantidad: i.cantidad, precioCentavos: Math.round(i.precio * 100) })),
            descuento
        });
        const totalCentavos = cot.totalCentavos;
        const totalCliente  = Math.round(Number(monto_total_venta) * 100);
        if (monto_total_venta !== undefined && totalCliente !== totalCentavos) {
            const err = new Error('Los precios cambiaron. Revise el carrito y vuelva a cobrar.');
            err.code       = 'PRECIO_DESACTUALIZADO';
            err.precios    = items.map(i => ({ id_producto: i.id_producto, precio_unitario: i.precio }));
            err.total      = totalCentavos / 100;
            err.cotizacion = promocionModel.enBolivianos(cot);
            throw err;
        }

        // 3. Registrar la venta principal (con su número del día)
        const numero_dia = await siguienteNumero(client, 'venta_caja', id_sucursal);
        const rVenta = await client.query(`
            INSERT INTO venta_caja
                (id_sucursal, id_usuario_cajero, id_turno, monto_total_venta, metodo_pago,
                 descuento_promociones, descuento_manual, motivo_descuento, numero_dia)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id_venta
        `, [
            Number(id_sucursal),
            Number(id_usuario_cajero),
            id_turno,
            totalCentavos / 100,
            metodo_pago,
            cot.promoCentavos / 100,
            cot.manualCentavos / 100,
            cot.motivo,
            numero_dia
        ]);
        const id_venta = rVenta.rows[0].id_venta;
        if (cot.manualCentavos > 0) await notificacionModel.descuentoManual(client, id_venta);

        // 4. Procesar cada ítem del carrito: lo reservado al agregarlo ya salió del stock; solo se descuenta lo que falte
        const cambiosStock = [];
        const reservas = await reservaModel.bloquear(client, Number(id_usuario_cajero));
        for (const item of cot.lineas) {
            const { cantidad } = item;
            const id_prod  = item.id_producto;
            const fila = reservas.get(id_prod);
            reservas.delete(id_prod);
            const usado = fila && fila.id_sucursal === Number(id_sucursal) ? Math.min(fila.cantidad, cantidad) : 0;
            // Lo reservado de más vuelve a su lote antes de tomar el costo de lo vendido
            if (fila) {
                const c = await reservaModel.devolver(client, fila, fila.cantidad - usado, Number(id_usuario_cajero));
                if (c) cambiosStock.push(c);
            }
            const partes = [];   // [unidades, costo por unidad]
            if (usado > 0) {
                const r = await costoReservado(client, { id_producto: id_prod, id_reserva: fila.id_reserva });
                partes.push([usado, r.unidades ? r.costo : await costoActual(client, id_prod)]);
                await reservaModel.vender(client, fila, id_venta);
            }
            const falta = cantidad - usado;
            if (falta > 0) {
                // Fila bloqueada: dos cajas no pueden vender el mismo stock a la vez (sale del lote más antiguo)
                const mov = await moverStock(client, {
                    id_sucursal: Number(id_sucursal), id_producto: id_prod, cantidad: -falta,
                    id_usuario: Number(id_usuario_cajero), motivo: 'Venta en Caja'
                });
                if (mov.falta || mov.existe === false) {
                    const rInfo = await client.query(`SELECT nombre_producto FROM producto WHERE id_producto = $1`, [id_prod]);
                    const err  = new Error(
                        `Stock insuficiente de "${rInfo.rows[0]?.nombre_producto || id_prod}" (disponible: ${mov.disponible ?? 0})`
                    );
                    err.code = 'STOCK_INSUFICIENTE';
                    throw err;
                }
                if (!mov.preparado)
                    cambiosStock.push({ id_producto: id_prod, id_sucursal: Number(id_sucursal), nuevo_stock: mov.stock });
                // Costo de lo vendido: el de los lotes de los que salió (lo preparado, el de su receta)
                partes.push([falta, mov.preparado ? await costoActual(client, id_prod) : costoDeLotes(mov.lotes)]);
            }
            const costo = partes.some(([, c]) => c == null) ? null
                : Math.round(partes.reduce((s, [q, c]) => s + q * Number(c), 0) / cantidad * 10000) / 10000;
            await client.query(`
                INSERT INTO detalle_venta
                    (id_venta, id_producto, cantidad_vendida, precio_unitario, subtotal_venta,
                     descuento_promocion, descuento_manual, id_promocion, costo_unitario)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [id_venta, id_prod, cantidad, item.precioCentavos / 100, item.netoCentavos / 100,
                item.descuentoPromoCentavos / 100, item.descuentoManualCentavos / 100, item.id_promocion, costo]);
        }

        // Lo que quedó reservado y no se vendió vuelve al stock
        for (const fila of reservas.values()) {
            const c = await reservaModel.devolver(client, fila, fila.cantidad, Number(id_usuario_cajero));
            if (c) cambiosStock.push(c);
        }
        await notificacionModel.stockTrasVenta(client, Number(id_sucursal), cot.lineas);

        await client.query('COMMIT');
        return { id_venta, numero_dia, cambiosStock, cotizacion: promocionModel.enBolivianos(cot) };

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
            t.monto_calculado::float8      AS efectivo_esperado,
            t.monto_real_declarado::float8 AS efectivo_contado,
            t.diferencia::float8           AS diferencia,
            t.cerrado_por,
            s.id_sucursal,
            u.nombre_completo            AS nombre_cajero,
            s.nombre_sucursal,
            COUNT(v.id_venta)::int       AS total_ventas,
            COALESCE(SUM(v.monto_total_venta), 0)                                             AS total_recaudado,
            COALESCE(SUM(CASE WHEN v.metodo_pago = '${METODO_PAGO.efectivo}' THEN v.monto_total_venta END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN v.metodo_pago = '${METODO_PAGO.qr}' THEN v.monto_total_venta END), 0) AS total_qr
        FROM turno_caja t
        JOIN usuario  u ON t.id_usuario_cajero = u.id_usuario
        JOIN sucursal s ON t.id_sucursal       = s.id_sucursal
        LEFT JOIN venta_caja v ON (
            v.id_turno = t.id_turno
            OR (
                v.id_turno IS NULL
                AND v.id_sucursal       = t.id_sucursal
                AND v.id_usuario_cajero = t.id_usuario_cajero
                AND v.fecha_venta >= t.fecha_hora_apertura
                AND v.fecha_venta <  COALESCE(t.fecha_hora_cierre, NOW())
            )
        )
        WHERE t.estado_turno = 'Cerrado'
        GROUP BY t.id_turno, s.id_sucursal, u.nombre_completo, s.nombre_sucursal
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
    obtenerArqueoHoy, obtenerVentasHoyPOS, obtenerComprobante,
    abrirTurno, cerrarCaja, reabrirTurno, cerrarTurnosVencidos, registrarVenta, calcularItemsVenta, turnoParaVender,
    obtenerCierresCaja,
    verificarTurnoHoy,
    obtenerEstadoCajaSucursal
};
