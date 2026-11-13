const db = require('../config/db');
const { AVISO } = require('./loteModel');

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
                'ingredientes', 'preparacion', 'destacado', 'mostrar_en_menu', 'tipo_producto', 'vida_util_horas'];

// Lo que se hace al momento (té, café) no lleva stock: siempre disponible para vender
const SIN_LIMITE = 9999;
const STOCK_VISIBLE = (p = 'p', i = 'i') =>
    `CASE WHEN ${p}.tipo_producto = 'PREPARADO' THEN ${SIN_LIMITE} ELSE GREATEST(${i}.cantidad_actual, 0) END`;

const crearProducto = async (datos, cliente = db) => {
    const campos = CAMPOS.filter(c => datos[c] !== undefined && datos[c] !== null);
    const r = await cliente.query(`
        INSERT INTO producto(${campos.join(', ')})
        VALUES(${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *
    `, campos.map(c => datos[c]));
    return r.rows[0];
};

const obtenerProductos = async (id_sucursal = 1, incluirInactivos = false) => {
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
            p.tipo_producto,
            p.vida_util_horas,
            c.id_categoria,
            c.nombre_categoria,
            ${STOCK_VISIBLE()} AS stock_actual,
            cfg.stock_minimo_defecto AS stock_minimo_alerta,
            COALESCE(v.vencidos, 0)   AS vencidos,
            COALESCE(v.por_vencer, 0) AS por_vencer
        FROM producto p
        JOIN categoria_producto   c ON p.id_categoria = c.id_categoria
        JOIN inventario_sucursal  i ON i.id_producto  = p.id_producto
                                   AND i.id_sucursal  = $1
        CROSS JOIN configuracion cfg
        -- Unidades vencidas o por vencer (lotes con stock; lo preparado no tiene)
        LEFT JOIN LATERAL (
            SELECT SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento <= LOCALTIMESTAMP)::int AS vencidos,
                   SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento > LOCALTIMESTAMP
                                                    AND l.fecha_vencimiento <= LOCALTIMESTAMP + ${AVISO('p', 'cfg')})::int AS por_vencer
            FROM lote_inventario l
            WHERE l.id_inventario = i.id_inventario AND l.cantidad_actual > 0
        ) v ON TRUE
        WHERE cfg.id_configuracion = 1 ${incluirInactivos ? '' : 'AND p.estado_activo = TRUE'}
        ORDER BY c.orden, c.nombre_categoria, p.nombre_producto
    `, [id_sucursal]);
    return r.rows;
};

const desactivarProducto = async (id) =>
    (await db.query(`UPDATE producto SET estado_activo=FALSE WHERE id_producto=$1 RETURNING *`,[id])).rows[0];

/**
 * Dónde se está vendiendo ahora: carritos de caja con stock apartado, mesas con la cuenta abierta y
 * pedidos QR sin confirmar (desactivarlo impediría cobrarlos). encargos: pendientes (solo aviso).
 */
const usoEnVenta = async (id) => (await db.query(`
    SELECT
        (SELECT COALESCE(json_agg(DISTINCT u.nombre_completo), '[]') FROM reserva_caja r JOIN usuario u ON u.id_usuario = r.id_usuario
          WHERE r.id_producto = $1 AND r.id_venta IS NULL AND r.cantidad > 0) AS carritos,
        (SELECT COALESCE(json_agg(DISTINCT s.nombre_sucursal || ' · mesa ' || m.numero_mesa), '[]')
           FROM detalle_cuenta d JOIN cuenta_mesa c ON c.id_cuenta = d.id_cuenta
           JOIN mesa_local m ON m.id_mesa = c.id_mesa JOIN sucursal s ON s.id_sucursal = m.id_sucursal
          WHERE d.id_producto = $1 AND d.id_venta IS NULL AND c.estado = 'Abierta') AS mesas,
        (SELECT COUNT(DISTINCT p.id_pedido)::int FROM detalle_pedido d JOIN pedido_mesa p ON p.id_pedido = d.id_pedido
          WHERE d.id_producto = $1 AND p.estado_pedido = 'Pendiente_Cajero') AS pedidos,
        (SELECT COUNT(DISTINCT e.id_encargo)::int FROM detalle_encargo d JOIN encargo e ON e.id_encargo = d.id_encargo
          WHERE d.id_producto = $1 AND e.estado = 'Recibido') AS encargos`, [id])).rows[0];

const reactivarProducto = async (id) =>
    (await db.query(`UPDATE producto SET estado_activo=TRUE WHERE id_producto=$1 RETURNING *`,[id])).rows[0];

const eliminarProducto = desactivarProducto;

/** Ruta de la foto actual (null = sin foto; undefined = el producto no existe) */
const urlImagen = async (id) =>
    (await db.query('SELECT url_imagen FROM producto WHERE id_producto = $1', [id])).rows[0]?.url_imagen;

const actualizarProducto = async (id, datos, cliente = db) => {
    const campos = CAMPOS.filter(c => datos[c] !== undefined);
    if (!campos.length) return (await cliente.query('SELECT * FROM producto WHERE id_producto = $1', [id])).rows[0];
    const r = await cliente.query(
        `UPDATE producto SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}
          WHERE id_producto = $${campos.length + 1} RETURNING *`,
        [...campos.map(c => datos[c]), id]);
    return r.rows[0];
};

// ─── Fila de inventario de un producto nuevo en una sucursal (en 0: el stock inicial entra con moverStock) ───
const asignarProductoASucursal = async (id_producto, id_sucursal, cliente = db) => {
    const r = await cliente.query(`
        INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual)
        VALUES ($1, $2, 0)
        RETURNING *
    `, [id_sucursal, id_producto]);
    return r.rows[0];
};

// ─── Un producto para todo el negocio, con su fila de inventario en cada sucursal ───
/** Productos activos que la sucursal todavía no tiene (para «Agregar a esta sucursal») */
const productosFaltantes = async (id_sucursal) => (await db.query(`
    SELECT p.id_producto, p.nombre_producto, p.precio_unitario, p.tipo_producto, p.url_imagen,
           c.id_categoria, c.nombre_categoria, c.orden,
           (SELECT string_agg(s.nombre_sucursal, ', ' ORDER BY s.nombre_sucursal)
            FROM inventario_sucursal i JOIN sucursal s ON s.id_sucursal = i.id_sucursal
            WHERE i.id_producto = p.id_producto) AS sucursales
    FROM producto p
    JOIN categoria_producto c ON c.id_categoria = p.id_categoria
    WHERE p.estado_activo
      AND NOT EXISTS (SELECT 1 FROM inventario_sucursal i WHERE i.id_producto = p.id_producto AND i.id_sucursal = $1)
    ORDER BY c.orden, c.nombre_categoria, p.nombre_producto`, [id_sucursal])).rows;

/** Otro producto con el mismo nombre (sin importar mayúsculas ni espacios), o null */
const mismoNombre = async (nombre, excluir = null) => (await db.query(`
    SELECT id_producto, nombre_producto, estado_activo FROM producto
    WHERE upper(regexp_replace(trim(nombre_producto), '[[:space:]]+', ' ', 'g')) = upper(regexp_replace(trim($1), '[[:space:]]+', ' ', 'g'))
      AND id_producto <> COALESCE($2::int, 0)
    LIMIT 1`, [nombre, excluir])).rows[0] || null;

/** Todos los productos con sus sucursales, para buscar nombres parecidos (en_sucursal: ya está en esa) */
const paraComparar = async (id_sucursal = null) => (await db.query(`
    SELECT p.id_producto, p.nombre_producto, p.estado_activo,
           COALESCE(string_agg(s.nombre_sucursal, ', ' ORDER BY s.id_sucursal), '') AS sucursales,
           COALESCE(bool_or(i.id_sucursal = $1), FALSE) AS en_sucursal
    FROM producto p
    LEFT JOIN inventario_sucursal i ON i.id_producto = p.id_producto
    LEFT JOIN sucursal s ON s.id_sucursal = i.id_sucursal
    GROUP BY p.id_producto`, [id_sucursal])).rows;

module.exports = {
    productosFaltantes, mismoNombre, paraComparar, usoEnVenta,
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
    asignarProductoASucursal,
    SIN_LIMITE,
    STOCK_VISIBLE
};