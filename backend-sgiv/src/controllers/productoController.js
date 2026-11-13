const m = require('../models/productoModel');
const parecidos = require('../utils/parecidos');
const { guardarImagen, borrarImagen } = require('../utils/imagenes');
const { emitirCatalogo, emitirStock } = require('../utils/tiempoReal');
const db = require('../config/db');
const { moverStock, TIPOS_PRODUCTO } = require('../models/inventarioModel');
const { mayusculas } = require('../utils/texto');
const { ErrorValidacion, revisar, numero } = require('../utils/validacion');

// Fotos de productos: el navegador ya las comprime (WebP, 800 px); el tope es por si llegan de otro cliente
const FOTO = { carpeta: 'productos', prefijo: 'prod', maxBytes: 1024 * 1024, formatos: ['png', 'jpg', 'webp'] };

/** Guarda la foto nueva si viene como data URI; undefined = no cambia. Error de validación → 400 */
const fotoNueva = (url_imagen) => {
    if (!String(url_imagen || '').startsWith('data:')) return undefined;
    try { return guardarImagen(url_imagen, FOTO); }
    catch (e) { e.status = 400; throw e; }
};

// ─── Datos del producto (undefined = no cambia; al crear, nombre, categoría y precio son obligatorios) ───
const booleano = (v) => v === undefined ? undefined : v === true || v === 'true';
const siViene  = (v, fn) => v === undefined ? undefined : fn(v);

const datosProducto = (b, nuevo = false) => {
    const exigido = (v) => nuevo && v === undefined ? null : v;
    return {
        id_categoria:         siViene(exigido(b.id_categoria), v => numero(v, { etiqueta: 'La categoría', obligatorio: true, min: 1, entero: true })),
        nombre_producto:      siViene(exigido(b.nombre_producto), v => mayusculas(revisar(v, 'nombre', { etiqueta: 'El nombre del producto', obligatorio: true, max: 100 }))),
        descripcion_producto: siViene(b.descripcion_producto, v => mayusculas(revisar(v, 'texto', { etiqueta: 'La descripción', max: 500, multilinea: true }))),
        precio_unitario:      siViene(exigido(b.precio_unitario), v => numero(v, { etiqueta: 'El precio', obligatorio: true, min: 0.1, max: 99999 })),
        ingredientes:         siViene(b.ingredientes, v => mayusculas(revisar(v, 'texto', { etiqueta: 'Los ingredientes', max: 400 }))),
        preparacion:          siViene(b.preparacion, v => mayusculas(revisar(v, 'texto', { etiqueta: 'La preparación', max: 500, multilinea: true }))),
        destacado:            booleano(b.destacado),
        mostrar_en_menu:      booleano(b.mostrar_en_menu),
        tipo_producto:        siViene(b.tipo_producto, v => {
                                  if (!TIPOS_PRODUCTO.includes(v)) throw new ErrorValidacion('Tipo de producto inválido');
                                  return v;
                              }),
        // Vacío = la de Ajustes según el tipo; hasta 10 años
        vida_util_horas:      siViene(b.vida_util_horas, v => numero(v, { etiqueta: 'La vida útil', min: 1, max: 87600, entero: true }))
    };
};

const agregarCategoria  = async (req, res) => {
    try {
        const nombre = mayusculas(revisar(req.body?.nombre_categoria, 'letras', { etiqueta: 'El nombre de la categoría', obligatorio: true, max: 50 }));
        const cat = await m.crearCategoria(nombre, req.body.descripcion_categoria || '');
        res.status(201).json({ categoria: cat });
    } catch(e) {
        if (e instanceof ErrorValidacion) return res.status(400).json({ error: e.message });
        res.status(500).json({ error: e.message });
    }
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

// ─── Receta del producto (de Costos): de ahí sale su costo por unidad ───
/** undefined = no se toca; null = sin receta; número = esa receta. Solo el administrador (los costos son suyos). */
const recetaElegida = (req) => {
    if (Number(req.usuario?.id_rol) !== 1 || !('id_receta' in (req.body || {}))) return undefined;
    const v = req.body.id_receta;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ErrorValidacion('Receta inválida');
    return n;
};

/** Una receta es de un solo producto y un producto tiene una sola receta */
const enlazarReceta = async (client, id_producto, id_receta) => {
    if (id_receta === undefined) return;
    if (id_receta) {
        const r = await client.query(`
            SELECT r.id_producto, p.nombre_producto FROM receta r LEFT JOIN producto p ON p.id_producto = r.id_producto
            WHERE r.id_receta = $1 FOR UPDATE OF r`, [id_receta]);
        if (!r.rows.length) throw new ErrorValidacion('La receta ya no existe');
        if (r.rows[0].id_producto && r.rows[0].id_producto !== id_producto)
            throw new ErrorValidacion(`Esa receta ya es de ${r.rows[0].nombre_producto}`);
    }
    await client.query(`UPDATE receta SET id_producto = NULL WHERE id_producto = $1 AND id_receta IS DISTINCT FROM $2::int`,
                       [id_producto, id_receta]);
    if (id_receta) await client.query(`UPDATE receta SET id_producto = $1 WHERE id_receta = $2`, [id_producto, id_receta]);
};

// ─── Un mismo producto en varias sucursales ───
/** Mensaje si el nombre ya lo usa otro producto (los productos son de todo el negocio) */
const nombreRepetido = async (nombre, excluir = null) => {
    if (!nombre) return null;
    const otro = await m.mismoNombre(nombre, excluir);
    if (!otro) return null;
    return otro.estado_activo
        ? `Ya existe el producto «${otro.nombre_producto}». Si no aparece en esta sucursal, agrégalo con «Agregar de otra sucursal».`
        : `Ya existe el producto «${otro.nombre_producto}», desactivado. Actívalo en vez de crear otro.`;
};

/**
 * Nombre casi igual al de otro producto (plurales, acentos, errores de escritura, otro orden):
 * hay que confirmarlo con confirmar_parecido. Devuelve la respuesta 409 o null.
 */
const parecidoSinConfirmar = async (req, nombre, id_sucursal, excluir = null) => {
    if (!nombre || req.body?.confirmar_parecido === true) return null;
    const lista = await m.paraComparar(id_sucursal);
    const propio = excluir && lista.find(p => p.id_producto === excluir);
    if (propio && parecidos.comparar(propio.nombre_producto, nombre).tipo === 'igual') return null;   // no cambió el nombre
    const casi = parecidos.buscar(nombre, lista, { excluir }).filter(parecidos.esCasiIgual);
    if (!casi.length) return null;
    return { error: `Ya existe «${casi[0].nombre_producto}», casi igual. Usa ese producto o confirma que es otro.`,
             codigo: 'PARECIDO', parecidos: casi };
};

// GET /api/catalogo/productos/parecidos?nombre&id_sucursal&excluir  (mientras se escribe el nombre)
const listarParecidos = async (req, res) => {
    try {
        const nombre = String(req.query.nombre || '').trim().slice(0, 100);
        if (nombre.length < 3) return res.json([]);
        const id_sucursal = sucursalPermitida(req, req.query.id_sucursal);
        const lista = await m.paraComparar(id_sucursal);
        res.json(parecidos.buscar(nombre, lista, { excluir: Number(req.query.excluir) || null }));
    } catch (e) {
        console.error('listarParecidos:', e.message);
        res.status(500).json({ error: 'No se pudieron buscar productos parecidos' });
    }
};

/** El cajero solo trabaja con su sucursal */
const sucursalPermitida = (req, pedida) => {
    const propia = Number(req.usuario.id_sucursal);
    if (Number(req.usuario.id_rol) === 1) return Number(pedida) || propia;
    return !pedida || Number(pedida) === propia ? propia : null;
};

// GET /catalogo/productos/faltantes?id_sucursal — los que la sucursal todavía no tiene
const listarFaltantes = async (req, res) => {
    try {
        const id_sucursal = sucursalPermitida(req, req.query.id_sucursal);
        if (!id_sucursal) return res.status(403).json({ error: 'Solo puedes ver tu sucursal' });
        res.json(await m.productosFaltantes(id_sucursal));
    } catch (e) {
        console.error('listarFaltantes:', e);
        res.status(500).json({ error: 'No se pudo cargar la lista' });
    }
};

// POST /catalogo/productos/agregar-a-sucursal { id_sucursal, productos: [{ id_producto, stock_inicial }] }
// El mismo producto (receta, costo y precio) en otra sucursal: todo o nada
const agregarASucursal = async (req, res) => {
    const client = await db.connect();
    try {
        const id_sucursal = sucursalPermitida(req, req.body?.id_sucursal);
        if (!id_sucursal) return res.status(403).json({ error: 'Solo puedes agregar productos a tu sucursal' });
        const lista = Array.isArray(req.body?.productos) ? req.body.productos : [];
        if (!lista.length || lista.length > 200) return res.status(400).json({ error: 'Elige al menos un producto' });
        const productos = lista.map(p => ({
            id_producto: numero(p?.id_producto, { etiqueta: 'El producto', obligatorio: true, min: 1, entero: true }),
            stock: numero(p?.stock_inicial, { etiqueta: 'El stock inicial', min: 0, max: 100000, entero: true }) ?? 0
        }));
        if (new Set(productos.map(p => p.id_producto)).size !== productos.length)
            return res.status(400).json({ error: 'Un producto está repetido' });

        await client.query('BEGIN');
        const rSuc = await client.query(`SELECT estado_activo FROM sucursal WHERE id_sucursal = $1`, [id_sucursal]);
        if (!rSuc.rows[0]?.estado_activo) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La sucursal no está activa' });
        }
        const cambios = [];
        for (const p of productos) {
            const rProd = await client.query(
                `SELECT nombre_producto, tipo_producto, estado_activo FROM producto WHERE id_producto = $1`, [p.id_producto]);
            const prod = rProd.rows[0];
            if (!prod?.estado_activo) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Un producto elegido ya no está activo. Vuelve a abrir la lista.' });
            }
            const rInv = await client.query(`
                INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 0)
                ON CONFLICT (id_sucursal, id_producto) DO NOTHING RETURNING id_inventario`, [id_sucursal, p.id_producto]);
            if (!rInv.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: `«${prod.nombre_producto}» ya está en esta sucursal` });
            }
            if (p.stock > 0 && prod.tipo_producto !== 'PREPARADO') {
                const r = await moverStock(client, { id_inventario: rInv.rows[0].id_inventario, id_usuario: req.usuario?.id_usuario,
                                                     cantidad: p.stock, motivo: 'Stock inicial' });
                cambios.push({ id_producto: p.id_producto, id_sucursal, nuevo_stock: r.stock });
            }
        }
        await client.query('COMMIT');
        emitirCatalogo();
        emitirStock(cambios);
        res.status(201).json({ agregados: productos.length });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        if (e.status === 400) return res.status(400).json({ error: e.message });
        console.error('agregarASucursal:', e);
        res.status(500).json({ error: 'No se pudieron agregar los productos' });
    } finally {
        client.release();
    }
};

// Crear producto Y asignarlo a la sucursal seleccionada
const agregarProducto   = async (req, res) => {
    let url_imagen = null;
    try {
        const { id_sucursal, stock_inicial } = req.body;
        const producto  = datosProducto(req.body, true);
        const stock_ini = numero(stock_inicial, { etiqueta: 'El stock inicial', min: 0, max: 100000, entero: true }) ?? 0;
        const id_receta = recetaElegida(req);

        url_imagen = fotoNueva(req.body.url_imagen) ?? null;

        const datos     = { ...producto, url_imagen };
        const id_suc    = Number(id_sucursal) || 1;
        const repetido  = await nombreRepetido(datos.nombre_producto);
        if (repetido) { borrarImagen(url_imagen); return res.status(409).json({ error: repetido }); }
        const parecido  = await parecidoSinConfirmar(req, datos.nombre_producto, id_suc);
        if (parecido) { borrarImagen(url_imagen); return res.status(409).json(parecido); }

        // Producto, su fila de inventario en la sucursal y el historial del stock inicial: todo o nada
        const client = await db.connect();
        let prod;
        try {
            await client.query('BEGIN');
            prod = await m.crearProducto(datos, client);
            // La receta antes del stock inicial: el primer lote ya entra con su costo
            await enlazarReceta(client, prod.id_producto, id_receta);
            const inv = await m.asignarProductoASucursal(prod.id_producto, id_suc, client);
            if (stock_ini > 0 && prod.tipo_producto !== 'PREPARADO') {
                await moverStock(client, {
                    id_inventario: inv.id_inventario, id_usuario: req.usuario?.id_usuario,
                    cantidad: stock_ini, motivo: 'Stock inicial'
                });
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
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

/**
 * Guarda los cambios del producto. Si pasa a «preparado al momento», su stock sale primero
 * (Ajuste de conteo) en todas las sucursales: lo preparado no lleva stock ni lotes.
 */
const guardarProducto = async (id, datos, id_usuario, id_receta = undefined) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const rAntes = await client.query(`SELECT tipo_producto FROM producto WHERE id_producto = $1 FOR UPDATE`, [id]);
        const cambios = [];
        if (datos.tipo_producto === 'PREPARADO' && rAntes.rows[0]?.tipo_producto !== 'PREPARADO') {
            const rInv = await client.query(`
                SELECT id_inventario, id_sucursal, cantidad_actual FROM inventario_sucursal
                WHERE id_producto = $1 AND cantidad_actual > 0 ORDER BY id_inventario`, [id]);
            for (const inv of rInv.rows) {
                await moverStock(client, {
                    id_inventario: inv.id_inventario, id_usuario, cantidad: -Number(inv.cantidad_actual),
                    motivo: 'Ajuste de conteo', detalle: 'PASA A PREPARADO AL MOMENTO'
                });
                cambios.push({ id_producto: id, id_sucursal: inv.id_sucursal, nuevo_stock: m.SIN_LIMITE });
            }
        }
        const prod = await m.actualizarProducto(id, datos, client);
        await enlazarReceta(client, id, id_receta);
        await client.query('COMMIT');
        return { prod, cambios };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

// Actualizar producto
const actualizarProducto = async (req, res) => {
    let url_imagen;
    try {
        const anterior = await m.urlImagen(req.params.id);
        if (anterior === undefined) return res.status(404).json({ error: 'Producto no encontrado' });

        const datos = datosProducto(req.body);
        const repetido = await nombreRepetido(datos.nombre_producto, Number(req.params.id));
        if (repetido) return res.status(409).json({ error: repetido });
        const parecido = await parecidoSinConfirmar(req, datos.nombre_producto, Number(req.usuario.id_sucursal), Number(req.params.id));
        if (parecido) return res.status(409).json(parecido);
        url_imagen = fotoNueva(req.body.url_imagen);
        const { prod, cambios } = await guardarProducto(Number(req.params.id), { ...datos, url_imagen }, req.usuario?.id_usuario,
                                                        recetaElegida(req));
        if (url_imagen) borrarImagen(anterior);
        if (cambios.length) emitirStock(cambios);
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
    agregarProducto,  actualizarProducto, eliminarProducto, reactivarProducto, listarFaltantes, agregarASucursal, listarParecidos
};