const db  = require('../config/db');
const QRCode = require('qrcode');

const crearMesa = async (id_sucursal, numero_mesa) => {
    const codigo_qr = `SGIV-SUC${id_sucursal}-MESA${numero_mesa}-${Date.now()}`;
    const query = `
        INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr, estado_mesa)
        VALUES ($1, $2, $3, 'Libre') RETURNING *;
    `;
    const result = await db.query(query, [id_sucursal, numero_mesa, codigo_qr]);
    return result.rows[0];
};

const obtenerMesasPorSucursal = async (id_sucursal) => {
    const query = `
        SELECT m.*,
               pm.id_pedido,
               pm.estado_pedido,
               pm.monto_total,
               pm.fecha_pedido
        FROM mesa_local m
        LEFT JOIN pedido_mesa pm ON pm.id_mesa = m.id_mesa
            AND pm.estado_pedido NOT IN ('Pagado', 'Cancelado')
        WHERE m.id_sucursal = $1
        ORDER BY m.numero_mesa ASC;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows;
};

const generarQRDataUrl = async (id_mesa, base_url = 'http://localhost:4200') => {
    const url = `${base_url}/menu/${id_mesa}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
    });
    return { url, qrDataUrl };
};

const actualizarEstadoMesa = async (id_mesa, estado_mesa) => {
    const result = await db.query(
        `UPDATE mesa_local SET estado_mesa = $2 WHERE id_mesa = $1 RETURNING *;`,
        [id_mesa, estado_mesa]
    );
    return result.rows[0];
};

const obtenerMesaPorId = async (id_mesa) => {
    const result = await db.query(
        `SELECT * FROM mesa_local WHERE id_mesa = $1;`,
        [id_mesa]
    );
    return result.rows[0];
};

module.exports = { crearMesa, obtenerMesasPorSucursal, generarQRDataUrl, actualizarEstadoMesa, obtenerMesaPorId };