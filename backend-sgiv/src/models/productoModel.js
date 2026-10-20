const db = require('../config/db');

// Las nuevas van al final del orden del menú
const crearCategoria    = async (nombre, desc) =>
    (await db.query(`INSERT INTO categoria_producto(nombre_categoria, descripcion_categoria, orden)
                     VALUES($1, $2, (SELECT COALESCE(MAX(orden), 0) + 1 FROM categoria_producto)) RETURNING *`,
                    [nombre, desc])).rows[0];

const obtenerCategorias = async () =>
    (await db.query(`SELECT * FROM categoria_producto ORDER BY orden, nombre_categoria`)).rows;

/** ids en el orden nuevo; las que no vengan quedan después */
const ordenarCategorias = async (ids) =>
    (await db.query(`
        UPDATE categoria_producto c
           SET orden = COALESCE((SELECT n.pos FROM unnest($1::int[]) WITH ORDINALITY AS n(id, pos)
                                  WHERE n.id = c.id_categoria LIMIT 1), 1000 + c.id_categoria)`, [ids])).rowCount;

const obtenerCategoriaPorId = async (id) =>
    (await db.query(`SELECT * FROM categoria_producto WHERE id_categoria = $1`, [id])).rows[0];

const productosDeCategoria = async (id) =>
    (await db.query(
        `SELECT id_producto, nombre_producto, estado_activo
           FROM producto
          WHERE id_categoria = $1
          ORDER BY estado_activo DESC, nombre_producto ASC`, [id])).rows;

const eliminarCategoria = async (id) =>
    (await db.query(`DELETE FROM categoria_producto WHERE id_categoria = $1 RETURNING *`, [id])).rows[0];

// Campos que el admin edita (undefined = no cambia)
const CAMPOS = ['id_categoria', 'nombre_producto', 'descripcion_producto', 'precio_unitario', 'url_imagen',
                'ingredientes', 'preparacion', 'destacado', 'mostrar_en_menu'];

const crearProducto = async (datos) => {
    const campos = CAMPOS.filter(c => datos[c] !== undefined && datos[c] !== null);
    const r = await db.query(`
        INSERT INTO producto(${campos.join(', ')})
        VALUES(${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *
    `, campos.map(c => datos[c]));
    return r.rows[0];
};

const obtenerProductos = async (id_sucursal = 1, incluirInactivos = false) => {
    const filtroEstado = incluirInactivos ? '' : 'WHERE p.estado_activo = TRUE';
    const r = await db.query(`
        SELECT
            p.id_producto,
            p.nombre_producto,
            p.descripcion_producto,
            p.precio_unitario,
            p.url_imagen,
            p.estado_activo,
            p.ingredientes,
            p.preparacion,
            p.destacado,
            p.mostrar_en_menu,
            c.id_categoria,
            c.nombre_categoria,
            i.cantidad_actual   AS stock_actual,
            i.stock_minimo_alerta
        FROM producto p
        JOIN categoria_producto   c ON p.id_categoria = c.id_categoria
        JOIN inventario_sucursal  i ON i.id_producto  = p.id_producto
                                   AND i.id_sucursal  = $1
        ${filtroEstado}
        ORDER BY c.orden, c.nombre_categoria, p.nombre_producto
    `, [id_sucursal]);
    return r.rows;
};

const desactivarProducto = async (id) =>
    (await db.query(`UPDATE producto SET estado_activo=FALSE WHERE id_producto=$1 RETURNING *`,[id])).rows[0];

const reactivarProducto = async (id) =>
    (await db.query(`UPDATE producto SET estado_activo=TRUE WHERE id_producto=$1 RETURNING *`,[id])).rows[0];

const eliminarProducto = desactivarProducto;

/** Ruta de la foto actual (null = sin foto; undefined = el producto no existe) */
const urlImagen = async (id) =>
    (await db.query('SELECT url_imagen FROM producto WHERE id_producto = $1', [id])).rows[0]?.url_imagen;

const actualizarProducto = async (id, datos) => {
    const campos = CAMPOS.filter(c => datos[c] !== undefined);
    if (!campos.length) return (await db.query('SELECT * FROM producto WHERE id_producto = $1', [id])).rows[0];
    const r = await db.query(
        `UPDATE producto SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}
          WHERE id_producto = $${campos.length + 1} RETURNING *`,
        [...campos.map(c => datos[c]), id]);
    return r.rows[0];
};

// ─── Agregar o actualizar stock para una sucursal específica ───
// ─── Crear entrada en inventario con stock 0 (para asignar producto a sucursal) ───
const asignarProductoASucursal = async (id_producto, id_sucursal, stock_inicial = 0) => {
    const r = await db.query(`
        INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual, stock_minimo_alerta)
        VALUES ($1, $2, $3, COALESCE((SELECT stock_minimo_defecto FROM configuracion WHERE id_configuracion = 1), 5))
        ON CONFLICT (id_sucursal, id_producto)
        DO UPDATE SET cantidad_actual = $3
        RETURNING *
    `, [id_sucursal, id_producto, stock_inicial]);
    return r.rows[0];
};

module.exports = {
    crearCategoria,
    obtenerCategorias,
    ordenarCategorias,
    obtenerCategoriaPorId,
    productosDeCategoria,
    eliminarCategoria,
    crearProducto,
    obtenerProductos,
    eliminarProducto,
    desactivarProducto,
    reactivarProducto,
    actualizarProducto,
    urlImagen,
    asignarProductoASucursal
};