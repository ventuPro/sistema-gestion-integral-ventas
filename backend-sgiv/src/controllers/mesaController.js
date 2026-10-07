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

const actualizarEstado = async (req, res) => {
    try {
        const mesa = await m.actualizarEstadoMesa(req.params.id_mesa, req.body.estado_mesa);
        res.json({ mesa });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
};

const eliminarMesa = async (req, res) => {
    try {
        const id_mesa = Number(req.params.id_mesa);
        if (!id_mesa) return res.status(400).json({ error: 'ID de mesa inválido' });

        const { cambiosStock } = await m.eliminarMesa(id_mesa);

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

module.exports = { agregarMesa, listarMesas, obtenerQR, regenerarQR, actualizarEstado, eliminarMesa };