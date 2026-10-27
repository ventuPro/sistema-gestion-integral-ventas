const crypto = require('crypto');

// ─── Menú QR en pruebas: abre la visita del celular y hace el pedido ───
const celularAzar = () => crypto.randomBytes(16).toString('hex');

const crearPedir = (api) => async (codigo, items, extra = {}) => {
    const cliente_mesa = extra.cliente_mesa || celularAzar();
    let visita = extra.visita;
    if (visita === undefined)
        visita = (await api('POST', `/menu/m/${codigo}/visita`, { body: { cliente_mesa, v: extra.v } })).body?.visita;
    return api('POST', `/menu/m/${codigo}/pedidos`, { body: { items, ...extra, cliente_mesa, visita } });
};

module.exports = { celularAzar, crearPedir };
