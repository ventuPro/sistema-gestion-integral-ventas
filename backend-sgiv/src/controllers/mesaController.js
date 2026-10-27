const m = require('../models/mesaModel');
const { emitirStock, emitirMesa } = require('../utils/tiempoReal');

// URL del frontend que irá dentro del QR (la que abrirá el celular del cliente).
// Solo http/https y sin ruta: evita generar QR que apunten a cualquier lado.
const normalizarBaseUrl = (valor) => {
    try {
        const u = new URL(String(valor || ''));
        if (!['http:', 'https:'].includes(u.protocol)) return null;
        return u.origin;
    } catch {
        return null;
    }
};

const agregarMesa = async (req, res) => {
    try {
        const { id_sucursal, numero_mesa } = req.body;
        if (!id_sucursal || !numero_mesa)
            return res.status(400).json({ error: 'id_sucursal y numero_mesa son requeridos' });
        const mesa = await m.crearMesa(id_sucursal, numero_mesa);
        res.status(201).json({ mesa });
    } catch(e) {
        console.error('agregarMesa:', e);
        res.status(500).json({ error: e.message });
    }
};

const listarMesas = async (req, res) => {
    try {
        res.json(await m.obtenerMesasPorSucursal(req.params.id_sucursal));
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
};

const obtenerQR = async (req, res) => {
    try {
        const id_mesa  = Number(req.params.id_mesa);
        const base_url = normalizarBaseUrl(req.query.base_url || 'http://localhost:4200');
        if (!id_mesa)  return res.status(400).json({ error: 'ID de mesa inválido' });
        if (!base_url) return res.status(400).json({ error: 'La dirección del menú no es válida (use http:// o https://)' });

        const result = await m.generarQR(id_mesa, base_url);
        res.json(result);
    } catch(e) {
        console.error('obtenerQR:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/mesas/sucursal/:id_sucursal/qr — todos los QR de la sucursal (el cajero solo la suya)
const obtenerQRSucursal = async (req, res) => {
    try {
        const id_sucursal = req.usuario.id_rol === 1 ? Number(req.params.id_sucursal) : Number(req.usuario.id_sucursal);
        const base_url    = normalizarBaseUrl(req.query.base_url || 'http://localhost:4200');
        if (!id_sucursal) return res.status(400).json({ error: 'Sucursal inválida' });
        if (!base_url)    return res.status(400).json({ error: 'La dirección del menú no es válida (use http:// o https://)' });

        res.json(await m.generarQRSucursal(id_sucursal, base_url));
    } catch(e) {
        console.error('obtenerQRSucursal:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/mesas/:id_mesa/qr/regenerar — el QR impreso anterior deja de funcionar
const regenerarQR = async (req, res) => {
    try {
        const id_mesa = Number(req.params.id_mesa);
        if (!id_mesa) return res.status(400).json({ error: 'ID de mesa inválido' });
        const mesa = await m.regenerarCodigoQR(id_mesa);
        // Los celulares conectados con el QR anterior dejan de recibir avisos
        global.io?.in(`mesa_${id_mesa}`).socketsLeave(`mesa_${id_mesa}`);
        res.json({ mensaje: `Nuevo QR generado para la Mesa ${mesa.numero_mesa}. Imprímalo y reemplace el anterior.` });
    } catch (e) {
        console.error('regenerarQR:', e);
        res.status(e.message === 'Mesa no encontrada' ? 404 : 500).json({ error: e.message });
    }
};

// ─── Habilitar / liberar (el cajero solo en su sucursal) ───
const ERRORES_MESA = { MESA_NO_ENCONTRADA: 404, CUENTA_ABIERTA: 409, MESA_LIBRE: 409 };

const conMesaPropia = (accion) => async (req, res) => {
    try {
        const id_mesa = Number(req.params.id_mesa);
        if (!Number.isInteger(id_mesa) || id_mesa <= 0) return res.status(400).json({ error: 'ID de mesa inválido' });
        const id_sucursal = await m.sucursalDeMesa(id_mesa);
        if (id_sucursal == null) return res.status(404).json({ error: 'Mesa no encontrada' });
        if (Number(req.usuario.id_rol) !== 1 && Number(req.usuario.id_sucursal) !== Number(id_sucursal))
            return res.status(403).json({ error: 'La mesa es de otra sucursal' });
        await accion(req, res, id_mesa);
    } catch (e) {
        const status = ERRORES_MESA[e.code];
        if (status) return res.status(status).json({ error: e.message, codigo: e.code });
        console.error('mesa:', e);
        res.status(500).json({ error: 'No se pudo actualizar la mesa' });
    }
};

// POST /api/mesas/:id_mesa/habilitar
const habilitar = conMesaPropia(async (req, res, id_mesa) => {
    const mesa = await m.habilitarMesa(id_mesa);
    global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
    res.json({ mensaje: `Mesa ${mesa.numero_mesa} habilitada` });
});

// POST /api/mesas/:id_mesa/liberar
const liberar = conMesaPropia(async (req, res, id_mesa) => {
    const mesa = await m.liberarMesa(id_mesa);
    global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
    emitirMesa(id_mesa, 'visita:terminada', {});
    res.json({ mensaje: `Mesa ${mesa.numero_mesa} liberada` });
});

// GET /api/mesas/:id_mesa/qr-visita
const obtenerQRVisita = conMesaPropia(async (req, res, id_mesa) => {
    const base_url = normalizarBaseUrl(req.query.base_url || 'http://localhost:4200');
    if (!base_url) return res.status(400).json({ error: 'La dirección del menú no es válida (use http:// o https://)' });
    res.json(await m.generarQRVisita(id_mesa, base_url));
});

const eliminarMesa = async (req, res) => {
    try {
        const id_mesa = Number(req.params.id_mesa);
        if (!id_mesa) return res.status(400).json({ error: 'ID de mesa inválido' });

        const { cambiosStock } = await m.eliminarMesa(id_mesa, req.usuario.id_usuario);

        // Notificar a cajeros que la mesa fue eliminada
        global.io?.to('cajeros').emit('mesa:actualizada', { id_mesa });
        global.io?.to('cajeros').emit('pedido:actualizado', { id_mesa, estado: 'Cancelado' });
        emitirMesa(id_mesa, 'cuenta:cerrada', {});
        emitirStock(cambiosStock);

        res.json({ mensaje: 'Mesa eliminada correctamente' });
    } catch (e) {
        console.error('eliminarMesa error:', e.message);
        res.status(500).json({ error: `Error al eliminar: ${e.message}` });
    }
};

module.exports = { agregarMesa, listarMesas, obtenerQR, obtenerQRSucursal, regenerarQR,
                   habilitar, liberar, obtenerQRVisita, eliminarMesa };