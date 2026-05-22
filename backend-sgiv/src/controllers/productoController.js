const m = require('../models/productoModel');
const { guardarBase64ComoArchivo } = require('../middlewares/uploadMiddleware');

const agregarCategoria  = async (req, res) => {
    try {
        const cat = await m.crearCategoria(req.body.nombre_categoria, req.body.descripcion_categoria || '');
        res.status(201).json({ categoria: cat });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const listarCategorias  = async (req, res) => {
    try { res.json(await m.obtenerCategorias()); }
    catch(e) { res.status(500).json({ error: e.message }); }
};

const eliminarCategoria = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ error: 'ID de categoría inválido' });
        }

        const cat = await m.obtenerCategoriaPorId(id);
        if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });

        const productos = await m.productosActivosDeCategoria(id);
        if (productos.length > 0) {
            return res.status(409).json({
                error: 'La categoría tiene productos activos',
                productos
            });
        }

        const confirmacion = (req.body && req.body.confirmacion) || '';
        if (confirmacion.trim() !== cat.nombre_categoria) {
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

// Listar productos — SOLO los de esa sucursal (INNER JOIN)
const listarProductos   = async (req, res) => {
    try {
        const id_sucursal = Number(req.query.id_sucursal) || 1;
        res.json(await m.obtenerProductos(id_sucursal));
    } catch(e) { res.status(500).json({ error: e.message }); }
};

// Crear producto Y asignarlo a la sucursal seleccionada
const agregarProducto   = async (req, res) => {
    try {
        const {
            id_categoria, nombre_producto, descripcion_producto,
            precio_unitario, id_sucursal, stock_inicial
        } = req.body;

        // Resolver imagen
        let url_imagen = null;
        if (req.file) {
            url_imagen = `/uploads/productos/${req.file.filename}`;
        } else if (req.body.url_imagen?.startsWith('data:')) {
            url_imagen = guardarBase64ComoArchivo(req.body.url_imagen);
        } else if (req.body.url_imagen) {
            url_imagen = req.body.url_imagen;
        }

        // 1. Crear el producto en el catálogo global
        const prod = await m.crearProducto({
            id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen
        });

        // 2. ASIGNAR el producto a la sucursal seleccionada con su stock inicial
        //    Sin este paso el producto NO aparece en ninguna sucursal
        const id_suc      = Number(id_sucursal) || 1;
        const stock_ini   = Number(stock_inicial) || 0;
        await m.asignarProductoASucursal(prod.id_producto, id_suc, stock_ini);

        res.status(201).json({ producto: prod });
    } catch(e) {
        console.error('agregarProducto:', e);
        res.status(500).json({ error: e.message });
    }
};

// Actualizar producto
const actualizarProducto = async (req, res) => {
    try {
        const { id_categoria, nombre_producto, descripcion_producto, precio_unitario } = req.body;

        let url_imagen = req.body.url_imagen || null;
        if (req.file) {
            url_imagen = `/uploads/productos/${req.file.filename}`;
        } else if (req.body.url_imagen?.startsWith('data:')) {
            url_imagen = guardarBase64ComoArchivo(req.body.url_imagen);
        }

        const prod = await m.actualizarProducto(req.params.id, {
            id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen
        });
        res.json({ producto: prod });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

const eliminarProducto  = async (req, res) => {
    try {
        await m.eliminarProducto(req.params.id);
        res.json({ mensaje: 'Producto eliminado' });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

// Agregar stock a una sucursal específica
const sumarStock = async (req, res) => {
    try {
        const id_sucursal = Number(req.body.id_sucursal) || 1;
        const cantidad    = Number(req.body.cantidad)    || 0;
        const r = await m.agregarStock(req.params.id, cantidad, id_sucursal);
        res.json({ mensaje: `Stock actualizado: ${r.cantidad_actual}`, inventario: r });
    } catch(e) { res.status(500).json({ error: e.message }); }
};

module.exports = {
    agregarCategoria, listarCategorias, eliminarCategoria, listarProductos,
    agregarProducto,  actualizarProducto, eliminarProducto, sumarStock
};