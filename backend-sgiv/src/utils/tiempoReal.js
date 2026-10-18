// ─── Tiempo real: salas 'cajeros', 'usuario_<id>' y 'mesa_<id_mesa>' ───

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

const emitirCatalogo = () => io()?.emit('catalogo:actualizado', {});

const emitirCajeros = (evento, datos) => io()?.to('cajeros').emit(evento, datos);

// Sala propia de cada usuario del personal ('usuario_<id>')
const emitirUsuario = (id_usuario, evento, datos = {}) => io()?.to(`usuario_${id_usuario}`).emit(evento, datos);

const emitirMesa = (id_mesa, evento, datos) => {
    if (id_mesa) io()?.to(`mesa_${id_mesa}`).emit(evento, datos);
};

module.exports = { emitirStock, emitirCatalogo, emitirCajeros, emitirUsuario, emitirMesa };
