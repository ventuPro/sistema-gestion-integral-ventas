const db = require('../config/db');

// ─── Configuración del negocio (una sola fila, id 1) ───
// La tabla la crea config/migraciones.js. Los valores por defecto son los del
// sistema original; colores en NULL = colores originales.
const CAMPOS_EMPRESA = ['nombre_comercial', 'razon_social', 'nit', 'rubro', 'eslogan', 'telefono', 'whatsapp',
                        'correo', 'sitio_web', 'direccion', 'ciudad', 'pais', 'facebook', 'instagram', 'tiktok'];
const CAMPOS_APARIENCIA = ['url_logo', 'url_favicon', 'color_primario', 'color_secundario', 'tema'];
const CAMPOS_PARAMETROS = ['moneda_simbolo', 'pago_efectivo', 'pago_qr', 'url_qr_cobro', 'ticket_mensaje_pie',
                           'menu_activo', 'menu_mensaje_bienvenida', 'menu_minutos_expiracion',
                           'menu_max_pendientes_mesa', 'menu_max_pedidos_ip', 'stock_minimo_defecto',
                           'captcha_activo', 'login_max_intentos', 'login_minutos_bloqueo', 'sesion_horas'];

// No se envían sin sesión
const PRIVADOS = ['id_configuracion', 'fecha_actualizacion', 'login_max_intentos', 'login_minutos_bloqueo',
                  'sesion_horas', 'menu_max_pedidos_ip', 'menu_max_pendientes_mesa', 'menu_minutos_expiracion',
                  'stock_minimo_defecto'];

// Valores del sistema original, por si la fila no existe
const POR_DEFECTO = {
    moneda_simbolo: 'Bs.', pago_efectivo: true, pago_qr: true, ticket_mensaje_pie: '¡Gracias por su compra!',
    menu_activo: true, menu_minutos_expiracion: 15, menu_max_pendientes_mesa: 3, menu_max_pedidos_ip: 10,
    stock_minimo_defecto: 5, captcha_activo: true, login_max_intentos: 5, login_minutos_bloqueo: 15, sesion_horas: 8
};

const obtener = async () => {
    const r = await db.query(`SELECT * FROM configuracion WHERE id_configuracion = 1`);
    return r.rows[0];
};

/** Datos visibles sin sesión (login, menú QR) */
const obtenerPublico = async () => {
    const c = await obtener();
    if (!c) return null;
    const publico = { ...c };
    for (const k of PRIVADOS) delete publico[k];
    return publico;
};

// ─── Parámetros con caché corta (login, pedidos y ventas los leen seguido) ───
const CACHE_MS = 30 * 1000;
let cache = null;
let cacheHasta = 0;

const parametros = async () => {
    if (cache && Date.now() < cacheHasta) return cache;
    cache = { ...POR_DEFECTO, ...(await obtener()) };
    cacheHasta = Date.now() + CACHE_MS;
    return cache;
};

const limpiarCache = () => { cache = null; };

/** null si el método de pago se puede usar; si no, el motivo */
const motivoMetodoPago = async (metodo) => {
    const p = await parametros();
    if (metodo === 'Efectivo') return p.pago_efectivo ? null : 'El pago en efectivo está deshabilitado';
    if (metodo === 'QR')       return p.pago_qr ? null : 'El pago por QR está deshabilitado';
    return 'Método de pago inválido';
};

// Solo se actualizan columnas de la lista permitida
const actualizar = async (datos, permitidos) => {
    const campos = Object.keys(datos).filter(k => permitidos.includes(k));
    if (!campos.length) return obtener();
    const sets = campos.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const r = await db.query(
        `UPDATE configuracion SET ${sets}, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_configuracion = 1 RETURNING *`,
        campos.map(k => datos[k]));
    limpiarCache();
    return r.rows[0];
};

module.exports = {
    obtener, obtenerPublico, parametros, limpiarCache, motivoMetodoPago, actualizar,
    CAMPOS_EMPRESA, CAMPOS_APARIENCIA, CAMPOS_PARAMETROS
};
