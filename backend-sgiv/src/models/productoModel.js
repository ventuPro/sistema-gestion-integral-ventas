    const db = require('../config/db');

// --- CATEGORÍAS ---
const crearCategoria = async (nombre, descripcion) => {
    const query = `
        INSERT INTO categoria_producto (nombre_categoria, descripcion_categoria) 
        VALUES ($1, $2) RETURNING *;
    `;
    const result = await db.query(query, [nombre, descripcion]);
    return result.rows[0];
};

const obtenerCategorias = async () => {
    const query = `SELECT * FROM categoria_producto;`;
    const result = await db.query(query);
    return result.rows;
};

// --- PRODUCTOS ---
const crearProducto = async (productoData) => {
    const { id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen } = productoData;
    const query = `
        INSERT INTO producto (id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const values = [id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen];
    const result = await db.query(query, values);
    return result.rows[0];
};

const obtenerProductos = async () => {
    const query = `
        SELECT p.*, c.nombre_categoria 
        FROM producto p
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        WHERE p.estado_activo = TRUE;
    `;
    const result = await db.query(query);
    return result.rows;
};

const eliminarProducto = async (id_producto) => {
    // En lugar de DELETE, usamos UPDATE para "apagar" el producto
    const query = `
        UPDATE producto 
        SET estado_activo = FALSE 
        WHERE id_producto = $1 
        RETURNING *;
    `;
    const result = await db.query(query, [id_producto]);
    return result.rows[0];
};


module.exports = { crearCategoria, obtenerCategorias, crearProducto, obtenerProductos, eliminarProducto };