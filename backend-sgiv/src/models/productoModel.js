const db = require('../config/db');

const crearCategoria = async (nombre, descripcion) => {
    const query = `
        INSERT INTO categoria_producto (nombre_categoria, descripcion_categoria) 
        VALUES ($1, $2) RETURNING *;
    `;
    const result = await db.query(query, [nombre, descripcion]);
    return result.rows[0];
};

const obtenerCategorias = async () => {
    const query = `SELECT * FROM categoria_producto ORDER BY nombre_categoria ASC;`;
    const result = await db.query(query);
    return result.rows;
};

const crearProducto = async (productoData) => {
    const { id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen } = productoData;
    const query = `
        INSERT INTO producto (id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const result = await db.query(query, [id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen || null]);
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
    const query = `UPDATE producto SET estado_activo = FALSE WHERE id_producto = $1 RETURNING *;`;
    const result = await db.query(query, [id_producto]);
    return result.rows[0];
};

// ACTUALIZADO: incluye url_imagen
const actualizarProducto = async (id_producto, productoData) => {
    const { id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen } = productoData;
    const query = `
        UPDATE producto 
        SET id_categoria = $1, nombre_producto = $2, descripcion_producto = $3, 
            precio_unitario = $4, url_imagen = $5
        WHERE id_producto = $6 
        RETURNING *;
    `;
    const result = await db.query(query, [id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen || null, id_producto]);
    return result.rows[0];
};

const agregarStock = async (id_producto, cantidad_agregada) => {
    const checkQuery = `SELECT * FROM inventario_sucursal WHERE id_sucursal = 1 AND id_producto = $1`;
    const checkResult = await db.query(checkQuery, [id_producto]);
    if (checkResult.rows.length > 0) {
        const updateQuery = `
            UPDATE inventario_sucursal 
            SET cantidad_actual = cantidad_actual + $2 
            WHERE id_sucursal = 1 AND id_producto = $1 
            RETURNING *;
        `;
        const result = await db.query(updateQuery, [id_producto, cantidad_agregada]);
        return result.rows[0];
    } else {
        const insertQuery = `
            INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) 
            VALUES (1, $1, $2) RETURNING *;
        `;
        const result = await db.query(insertQuery, [id_producto, cantidad_agregada]);
        return result.rows[0];
    }
};

module.exports = { crearCategoria, obtenerCategorias, crearProducto, obtenerProductos, eliminarProducto, actualizarProducto, agregarStock };