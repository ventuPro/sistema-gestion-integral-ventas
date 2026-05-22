const db = require('../config/db');

const crearCategoria    = async (nombre, desc) =>
    (await db.query(`INSERT INTO categoria_producto(nombre_categoria,descripcion_categoria) VALUES($1,$2) RETURNING *`,[nombre,desc])).rows[0];

const obtenerCategorias = async () =>
    (await db.query(`SELECT * FROM categoria_producto ORDER BY nombre_categoria ASC`)).rows;

const obtenerCategoriaPorId = async (id) =>
    (await db.query(`SELECT * FROM categoria_producto WHERE id_categoria = $1`, [id])).rows[0];

const productosActivosDeCategoria = async (id) =>
    (await db.query(
        `SELECT id_producto, nombre_producto
           FROM producto
          WHERE id_categoria = $1 AND estado_activo = TRUE
          ORDER BY nombre_producto ASC`, [id])).rows;

const eliminarCategoria = async (id) =>
    (await db.query(`DELETE FROM categoria_producto WHERE id_categoria = $1 RETURNING *`, [id])).rows[0];

const crearProducto = async ({ id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen }) => {
    const r = await db.query(`
        INSERT INTO producto(id_categoria,nombre_producto,descripcion_producto,precio_unitario,url_imagen)
        VALUES($1,$2,$3,$4,$5) RETURNING *
    `, [id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen || null]);
    return r.rows[0];
};

// ─── FIX DEFINITIVO: INNER JOIN → solo muestra productos de ESA sucursal ───
const obtenerProductos = async (id_sucursal = 1) => {
    const r = await db.query(`
        SELECT
            p.id_producto,
            p.nombre_producto,
            p.descripcion_producto,
            p.precio_unitario,
            p.url_imagen,
            p.estado_activo,
            c.id_categoria,
            c.nombre_categoria,
            i.cantidad_actual   AS stock_actual,
            i.stock_minimo_alerta
        FROM producto p
        JOIN categoria_producto   c ON p.id_categoria = c.id_categoria
        JOIN inventario_sucursal  i ON i.id_producto  = p.id_producto
                                   AND i.id_sucursal  = $1
        WHERE p.estado_activo = TRUE
        ORDER BY c.nombre_categoria ASC, p.nombre_producto ASC
    `, [id_sucursal]);
    return r.rows;
};

const eliminarProducto = async (id) =>
    (await db.query(`UPDATE producto SET estado_activo=FALSE WHERE id_producto=$1 RETURNING *`,[id])).rows[0];

const actualizarProducto = async (id, { id_categoria, nombre_producto, descripcion_producto, precio_unitario, url_imagen }) => {
    const vals  = [id_categoria, nombre_producto, descripcion_producto, precio_unitario, id];
    let   query = `UPDATE producto
                   SET id_categoria=$1, nombre_producto=$2, descripcion_producto=$3, precio_unitario=$4`;
    if (url_imagen !== undefined && url_imagen !== null) {
        vals.splice(4, 0, url_imagen);
        query += `, url_imagen=$5 WHERE id_producto=$6 RETURNING *`;
    } else {
        query += ` WHERE id_producto=$5 RETURNING *`;
    }
    return (await db.query(query, vals)).rows[0];
};

// ─── Agregar o actualizar stock para una sucursal específica ───
const agregarStock = async (id_producto, cantidad, id_sucursal = 1) => {
    // Upsert: si existe el registro actualiza, si no existe lo crea
    const r = await db.query(`
        INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual, stock_minimo_alerta)
        VALUES ($1, $2, $3, 5)
        ON CONFLICT (id_sucursal, id_producto)
        DO UPDATE SET cantidad_actual = inventario_sucursal.cantidad_actual + $3
        RETURNING *
    `, [id_sucursal, id_producto, cantidad]);
    return r.rows[0];
};

// ─── Crear entrada en inventario con stock 0 (para asignar producto a sucursal) ───
const asignarProductoASucursal = async (id_producto, id_sucursal, stock_inicial = 0) => {
    const r = await db.query(`
        INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual, stock_minimo_alerta)
        VALUES ($1, $2, $3, 5)
        ON CONFLICT (id_sucursal, id_producto)
        DO UPDATE SET cantidad_actual = $3
        RETURNING *
    `, [id_sucursal, id_producto, stock_inicial]);
    return r.rows[0];
};

module.exports = {
    crearCategoria,
    obtenerCategorias,
    obtenerCategoriaPorId,
    productosActivosDeCategoria,
    eliminarCategoria,
    crearProducto,
    obtenerProductos,
    eliminarProducto,
    actualizarProducto,
    agregarStock,
    asignarProductoASucursal
};