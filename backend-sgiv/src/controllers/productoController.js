const m = require('../models/productoModel');
const { guardarImagen, borrarImagen } = require('../utils/imagenes');
const { emitirCatalogo } = require('../utils/tiempoReal');
const db = require('../config/db');
const { registrarHistorial } = require('../models/inventarioModel');
const { soloLetras, mayusculas } = require('../utils/texto');

// Fotos de productos: el navegador ya las comprime (WebP, 800 px); el tope es por si llegan de otro cliente
const FOTO = { carpeta: 'productos', prefijo: 'prod', maxBytes: 1024 * 1024, formatos: ['png', 'jpg', 'webp'] };

/** Guarda la foto nueva si viene como data URI; undefined = no cambia. Error de validación → 400 */
const fotoNueva = (url_imagen) => {
    if (!String(url_imagen || '').startsWith('data:')) return undefined;
    try { return guardarImagen(url_imagen, FOTO); }
    catch (e) { e.status = 400; throw e; }
};

// ─── Ficha del producto para el menú QR (undefined = no cambia) ───
const texto    = (v, max) => v === undefined ? undefined : (String(v ?? '').trim().slice(0, max) || null);
const booleano = (v) => v === undefined ? undefined : v === true || v === 'true';

const datosProducto = (b) => ({
    id_categoria:         b.id_categoria,
    nombre_producto:      mayusculas(b.nombre_producto),
    descripcion_producto: mayusculas(b.descripcion_producto),
    precio_unitario:      b.precio_unitario,
    ingredientes:         mayusculas(texto(b.ingredientes, 400)),
    preparacion:          mayusculas(texto(b.preparacion, 500)),
    destacado:            booleano(b.destacado),
    mostrar_en_menu:      booleano(b.mostrar_en_menu)
});

const agregarCategoria  = async (req, res) => {
    try {
        const nombre = mayusculas(String(req.body?.nombre_categoria ?? '').trim());
        if (!nombre) return res.status(400).json({ error: 'Escribe el nombre de la categoría' });
        if (!soloLetras(nombre)) return res.status(400).json({ error: 'El nombre de la categoría solo admite letras' });
        const cat = await m.crearCategoria(nombre, req.body.descripcion_categoria || '');
        res.status(201).json({ categoria: cat });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const listarCategorias  = async (req, res) => {
    try { res.json(await m.obtenerCategorias()); }
    catch(e) { res.status(500).json({ error: e.message }); }
};

// PUT /catalogo/categorias/orden { ids: [...] }  orden del menú QR
const ordenarCategorias = async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
        if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
            return res.status(400).json({ error: 'Orden de categorías inválido' });
        await m.ordenarCategorias(ids.slice(0, 500));
        emitirCatalogo();
        res.json(await m.obtenerCategorias());
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const eliminarCategoria = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ error: 'ID de categoría inválido' });
        }

        const cat = await m.obtenerCategoriaPorId(id);
        if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });

        const productos = await m.productosDeCategoria(id);
        if (productos.length > 0) {
            const activos = productos.filter(p => p.estado_activo);
            return res.status(409).json({
                error: activos.length > 0
                    ? 'La categoría tiene productos activos'
                    : 'La categoría tiene productos asociados (incluso eliminados). No se puede borrar.',
                productos
            });
        }

        const confirmacion = (req.body && req.body.confirmacion) || '';
        if (mayusculas(confirmacion.trim()) !== mayusculas(cat.nombre_categoria)) {
            return res.status(400).json({
                error: 'Debes escribir el nombre exacto de la categoría para confirmar'
            });
        }

        await m.eliminarCategoria(id);
        res.json({ mensaje: 'Categoría eliminada', categoria: cat });
    } catch(e) {
        console.error('eliminarCategoria:', e);
        res.status(500).json({ error: e.message });
    }
};

// Listar productos — SOLO los de esa sucursal. Opcionalmente incluye inactivos (para Inventario).
const listarProductos   = async (req, res) => {
    try {
        const id_sucursal        = Number(req.query.id_sucursal) || 1;
        const incluirInactivos   = String(req.query.incluir_inactivos || '') === 'true';
        res.json(await m.obtenerProductos(id_sucursal, incluirInactivos));
    } catch(e) { res.status(500).json({ error: e.message }); }
};

// Crear producto Y asignarlo a la sucursal seleccionada
const agregarProducto   = async (req, res) => {
    let url_imagen = null;
    try {
        const { id_sucursal, stock_inicial } = req.body;

        url_imagen = fotoNueva(req.body.url_imagen) ?? null;

        // 1. Crear el producto en el catálogo global
        const prod = await m.crearProducto({ ...datosProducto(req.body), url_imagen });

        // 2. ASIGNAR el producto a la sucursal seleccionada con su stock inicial
        //    Sin este paso el producto NO aparece en ninguna sucursal
        const id_suc      = Number(id_sucursal) || 1;
        const stock_ini   = Math.max(Math.trunc(Number(stock_inicial)) || 0, 0);
        const inv = await m.asignarProductoASucursal(prod.id_producto, id_suc, stock_ini);
        if (stock_ini > 0) {
            await registrarHistorial(db, {
                id_inventario: inv.id_inventario, id_usuario: req.usuario?.id_usuario, tipo: 'INGRESO',
                cantidad: stock_ini, motivo: 'Stock inicial', stock_resultante: stock_ini
            });
        }

        emitirCatalogo();
        res.status(201).json({ producto: prod });
    } catch(e) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        borrarImagen(url_imagen);
        console.error('agregarProducto:', e);
        res.status(500).json({ error: e.message });
    }
};

// Actualizar producto
const actualizarProducto = async (req, res) => {
    let url_imagen;
    try {
        const anterior = await m.urlImagen(req.params.id);
        if (anterior === undefined) return res.status(404).json({ error: 'Producto no encontrado' });

        url_imagen = fotoNueva(req.body.url_imagen);
        const prod = await m.actualizarProducto(req.params.id, { ...datosProducto(req.body), url_imagen });
        if (url_imagen) borrarImagen(anterior);
        emitirCatalogo();
        res.json({ producto: prod });
    } catch(e) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        borrarImagen(url_imagen);
        res.status(500).json({ error: e.message });
    }
};

const eliminarProducto  = async (req, res) => {
    try {
        await m.desactivarProducto(req.params.id);
        emitirCatalogo();
        res.json({ mensaje: 'Producto desactivado' });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const reactivarProducto = async (req, res) => {
    try {
        const prod = await m.reactivarProducto(req.params.id);
        if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
        emitirCatalogo();
        res.json({ mensaje: 'Producto reactivado', producto: prod });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

module.exports = {
    agregarCategoria, listarCategorias, ordenarCategorias, eliminarCategoria, listarProductos,
    agregarProducto,  actualizarProducto, eliminarProducto, reactivarProducto
};