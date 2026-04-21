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
        SELECT 
            p.*, 
            c.nombre_categoria,
            COALESCE(i.cantidad_actual, 0) AS stock_actual
        FROM producto p
        LEFT JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto AND i.id_sucursal = 1
        WHERE p.estado_activo = TRUE
        ORDER BY p.id_producto DESC;
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

const actualizarProducto = async (id_producto, productoData) => {
    const { id_categoria, nombre_producto, descripcion_producto, precio_unitario } = productoData;
    const query = `
        UPDATE producto 
        SET id_categoria = $1, nombre_producto = $2, descripcion_producto = $3, precio_unitario = $4
        WHERE id_producto = $5 
        RETURNING *;
    `;
    const values = [id_categoria, nombre_producto, descripcion_producto, precio_unitario, id_producto];
    const result = await db.query(query, values);
    return result.rows[0];
};

const agregarStock = async (id_producto, cantidad_agregada) => {
    // 1. Verificamos si el producto ya tiene un registro en la sucursal 1
    const checkQuery = `SELECT * FROM inventario_sucursal WHERE id_sucursal = 1 AND id_producto = $1`;
    const checkResult = await db.query(checkQuery, [id_producto]);

    if (checkResult.rows.length > 0) {
        // SI YA EXISTE: Simplemente le sumamos la cantidad (UPDATE)
        const updateQuery = `
            UPDATE inventario_sucursal 
            SET cantidad_actual = cantidad_actual + $2 
            WHERE id_sucursal = 1 AND id_producto = $1 
            RETURNING *;
        `;
        const result = await db.query(updateQuery, [id_producto, cantidad_agregada]);
        return result.rows[0];
    } else {
        // SI NO EXISTE: Es un producto nuevo, lo insertamos por primera vez (INSERT)
        const insertQuery = `
            INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) 
            VALUES (1, $1, $2) 
            RETURNING *;
        `;
        const result = await db.query(insertQuery, [id_producto, cantidad_agregada]);
        return result.rows[0];
    }
};

module.exports = { crearCategoria, obtenerCategorias, crearProducto, obtenerProductos, eliminarProducto, actualizarProducto, agregarStock };