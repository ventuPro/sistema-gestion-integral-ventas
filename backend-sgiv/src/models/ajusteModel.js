const db = require('../config/db');

// ─── Configuración del negocio (una sola fila, id 1) ───
// La tabla la crea config/migraciones.js. Los valores por defecto son los del
// sistema original; colores en NULL = colores originales.
const CAMPOS_EMPRESA = ['nombre_comercial', 'razon_social', 'nit', 'rubro', 'eslogan', 'telefono', 'whatsapp',
                        'correo', 'sitio_web', 'direccion', 'ciudad', 'pais', 'facebook', 'instagram', 'tiktok'];
const CAMPOS_APARIENCIA = ['url_logo', 'url_favicon', 'color_primario', 'color_secundario', 'tema'];

const obtener = async () => {
    const r = await db.query(`SELECT * FROM configuracion WHERE id_configuracion = 1`);
    return r.rows[0];
};

/** Datos visibles sin sesión (login, menú QR): todo menos metadatos internos. */
const obtenerPublico = async () => {
    const c = await obtener();
    if (!c) return null;
    const { id_configuracion, fecha_actualizacion, ...publico } = c;
    return publico;
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
    return r.rows[0];
};

module.exports = { obtener, obtenerPublico, actualizar, CAMPOS_EMPRESA, CAMPOS_APARIENCIA };
