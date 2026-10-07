const db     = require('../config/db');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pedidoModel = require('./pedidoModel');
const cuentaModel = require('./cuentaModel');

// Código aleatorio que identifica la mesa en la URL del menú (/menu/<codigo>).
// No se usa el id interno porque es fácil de adivinar.
const nuevoCodigoQR = () => crypto.randomBytes(16).toString('hex');

const crearMesa = async (id_sucursal, numero_mesa) => {
    // Verificar que no exista esa mesa en esa sucursal
    const existe = await db.query(
        `SELECT id_mesa FROM mesa_local WHERE id_sucursal=$1 AND numero_mesa=$2`,
        [id_sucursal, numero_mesa]
    );
    if (existe.rows.length > 0)
        throw new Error(`Ya existe la Mesa ${numero_mesa} en esa sucursal`);

    const codigo_qr = nuevoCodigoQR();
    const r = await db.query(
        `INSERT INTO mesa_local(id_sucursal, numero_mesa, codigo_qr, estado_mesa)
         VALUES($1, $2, $3, 'Libre') RETURNING *`,
        [id_sucursal, numero_mesa, codigo_qr]
    );
    return r.rows[0];
};

const obtenerMesasPorSucursal = async (id_sucursal) => {
    const r = await db.query(`
        SELECT
            m.id_mesa, m.numero_mesa, m.estado_mesa, m.codigo_qr, m.id_sucursal,
            c.id_cuenta, c.total_acumulado, c.fecha_apertura,
            (SELECT COUNT(*)::int FROM detalle_cuenta dc WHERE dc.id_cuenta=c.id_cuenta) AS num_items
        FROM mesa_local m
        LEFT JOIN cuenta_mesa c ON c.id_mesa=m.id_mesa AND c.estado='Abierta'
        WHERE m.id_sucursal=$1
        ORDER BY m.numero_mesa ASC
    `, [id_sucursal]);
    return r.rows;
};

const generarQR = async (id_mesa, base_url) => {
    const r = await db.query(
        `SELECT m.*, s.nombre_sucursal FROM mesa_local m
         JOIN sucursal s ON m.id_sucursal=s.id_sucursal
         WHERE m.id_mesa=$1`,
        [id_mesa]
    );
    if (!r.rows.length) throw new Error('Mesa no encontrada');

    const mesa = r.rows[0];
    const url  = `${base_url}/menu/${mesa.codigo_qr}`;

    // Generar QR de alta calidad
    const qr = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        type:    'image/png',
        quality: 0.92,
        margin:  2,
        width:   400,
        color:   { dark: '#000000', light: '#FFFFFF' }
    });

    return { url, qr, numero_mesa: mesa.numero_mesa, id_sucursal: mesa.id_sucursal };
};

// Invalida el QR anterior (por ejemplo, si alguien lo fotografió y hace pedidos falsos)
const regenerarCodigoQR = async (id_mesa) => {
    const r = await db.query(
        `UPDATE mesa_local SET codigo_qr = $1 WHERE id_mesa = $2 RETURNING id_mesa, numero_mesa`,
        [nuevoCodigoQR(), id_mesa]
    );
    if (!r.rows.length) throw new Error('Mesa no encontrada');
    return r.rows[0];
};

const actualizarEstadoMesa = async (id_mesa, estado_mesa) => {
    const r = await db.query(
        `UPDATE mesa_local SET estado_mesa=$1 WHERE id_mesa=$2 RETURNING *`,
        [estado_mesa, id_mesa]
    );
    return r.rows[0];
};

const eliminarMesa = async (id_mesa) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Cancelar cualquier cuenta activa devolviendo su stock reservado
        let cambiosStock = [];
        const rCuentas = await client.query(
            `SELECT id_cuenta FROM cuenta_mesa WHERE id_mesa = $1 AND estado = 'Abierta'`, [id_mesa]);
        for (const { id_cuenta } of rCuentas.rows) {
            cambiosStock = cambiosStock.concat(await cuentaModel.devolverStockCuenta(client, id_cuenta));
            await pedidoModel.finalizarPedidosDeCuenta(client, id_cuenta, 'Cancelado');
            await client.query(
                `UPDATE cuenta_mesa SET estado = 'Cancelada', fecha_cierre = NOW() WHERE id_cuenta = $1`, [id_cuenta]);
        }

        // Pedidos QR sin confirmar: se cancelan y su stock vuelve
        cambiosStock = cambiosStock.concat((await pedidoModel.cancelarPendientesMesa(client, id_mesa)).cambios);

        // detalle_pedido y venta_caja referencian pedido_mesa sin ON DELETE CASCADE:
        // sin esto, borrar una mesa que alguna vez recibió pedidos QR falla por FK.
        await client.query(`
            UPDATE venta_caja SET id_pedido_mesa = NULL
            WHERE id_pedido_mesa IN (SELECT id_pedido FROM pedido_mesa WHERE id_mesa = $1)
        `, [id_mesa]);
        await client.query(`
            DELETE FROM detalle_pedido
            WHERE id_pedido IN (SELECT id_pedido FROM pedido_mesa WHERE id_mesa = $1)
        `, [id_mesa]);

        // Eliminar la mesa (pedido_mesa y cuenta_mesa caen por ON DELETE CASCADE)
        const r = await client.query(
            `DELETE FROM mesa_local WHERE id_mesa = $1 RETURNING *`,
            [id_mesa]
        );

        if (!r.rows.length) throw new Error('Mesa no encontrada');

        await client.query('COMMIT');
        return { mesa: r.rows[0], cambiosStock };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

module.exports = { crearMesa, obtenerMesasPorSucursal, generarQR, regenerarCodigoQR, actualizarEstadoMesa, eliminarMesa };