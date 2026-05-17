const db     = require('../config/db');
const QRCode = require('qrcode');

const crearMesa = async (id_sucursal, numero_mesa) => {
    // Verificar que no exista esa mesa en esa sucursal
    const existe = await db.query(
        `SELECT id_mesa FROM mesa_local WHERE id_sucursal=$1 AND numero_mesa=$2`,
        [id_sucursal, numero_mesa]
    );
    if (existe.rows.length > 0)
        throw new Error(`Ya existe la Mesa ${numero_mesa} en esa sucursal`);

    const codigo_qr = `SUC${id_sucursal}-MESA${numero_mesa}-${Date.now()}`;
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
    const url  = `${base_url}/menu/${id_mesa}`;

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

const actualizarEstadoMesa = async (id_mesa, estado_mesa) => {
    const r = await db.query(
        `UPDATE mesa_local SET estado_mesa=$1 WHERE id_mesa=$2 RETURNING *`,
        [estado_mesa, id_mesa]
    );
    return r.rows[0];
};

module.exports = { crearMesa, obtenerMesasPorSucursal, generarQR, actualizarEstadoMesa };