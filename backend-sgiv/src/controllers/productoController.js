const productoModel = require('../models/productoModel');

// --- CATEGORÍAS ---
const agregarCategoria = async (req, res) => {
    try {
        const { nombre_categoria, descripcion_categoria } = req.body;
        const nuevaCategoria = await productoModel.crearCategoria(nombre_categoria, descripcion_categoria);
        res.status(201).json({ mensaje: 'Categoría creada exitosamente', categoria: nuevaCategoria });
    } catch (error) {
        console.error('Error en agregarCategoria:', error);
        res.status(500).json({ error: 'Error al crear la categoría' });
    }
};

const listarCategorias = async (req, res) => {
    try {
        const categorias = await productoModel.obtenerCategorias();
        res.json(categorias);
    } catch (error) {
        console.error('Error en listarCategorias:', error);
        res.status(500).json({ error: 'Error al obtener las categorías' });
    }
};

// --- PRODUCTOS ---
const agregarProducto = async (req, res) => {
    try {
        const nuevoProducto = await productoModel.crearProducto(req.body);
        res.status(201).json({ mensaje: 'Producto creado exitosamente', producto: nuevoProducto });
    } catch (error) {
        console.error('Error en agregarProducto:', error);
        res.status(500).json({ error: 'Error al crear el producto' });
    }
};

const listarProductos = async (req, res) => {
    try {
        const productos = await productoModel.obtenerProductos();
        res.json(productos);
    } catch (error) {
        console.error('Error en listarProductos:', error);
        res.status(500).json({ error: 'Error al obtener los productos' });
    }
};


const eliminarProducto = async (req, res) => {
    try {
        const { id } = req.params; // Capturamos el ID que viene en la URL
        const productoEliminado = await productoModel.eliminarProducto(id);
        
        if (!productoEliminado) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
        res.json({ mensaje: 'Producto eliminado (desactivado) exitosamente' });
    } catch (error) {
        console.error('Error en eliminarProducto:', error);
        res.status(500).json({ error: 'Error al eliminar el producto' });
    }
};

const actualizarProducto = async (req, res) => {
    try {
        const { id } = req.params; // El ID del producto que vamos a editar
        const productoActualizado = await productoModel.actualizarProducto(id, req.body);
        
        if (!productoActualizado) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        
        res.json({ mensaje: 'Producto actualizado exitosamente', producto: productoActualizado });
    } catch (error) {
        console.error('Error en actualizarProducto:', error);
        res.status(500).json({ error: 'Error al actualizar el producto' });
    }
};

module.exports = { agregarCategoria, listarCategorias, agregarProducto, listarProductos, eliminarProducto, actualizarProducto };