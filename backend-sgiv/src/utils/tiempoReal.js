// ─── Notificaciones en tiempo real (Socket.IO) ───
// Salas: 'cajeros' (personal autenticado) y 'mesa_<id_mesa>' (menú digital
// del cliente). El stock se difunde a todos: lo usan POS, Mesas y el menú QR.

const io = () => global.io;

// cambios: [{ id_producto, id_sucursal, nuevo_stock }]
const emitirStock = (cambios = []) => {
    for (const c of cambios) {
        io()?.emit('actualizacion_stock_global', {
            id_producto:               Number(c.id_producto),
            id_sucursal:               Number(c.id_sucursal),
            nueva_cantidad_disponible: Number(c.nuevo_stock)
        });
    }
};

// Producto creado, editado, desactivado o reactivado: el menú recarga su catálogo
const emitirCatalogo = () => io()?.emit('catalogo:actualizado', {});

const emitirCajeros = (evento, datos) => io()?.to('cajeros').emit(evento, datos);

const emitirMesa = (id_mesa, evento, datos) => {
    if (id_mesa) io()?.to(`mesa_${id_mesa}`).emit(evento, datos);
};

module.exports = { emitirStock, emitirCatalogo, emitirCajeros, emitirMesa };
