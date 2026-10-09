const ajusteModel = require('../models/ajusteModel');
const { guardarImagen } = require('../middlewares/uploadMiddleware');

// ─── Reglas de validación ───
const TELEFONO = /^[0-9+()\s-]{6,20}$/;
const URL_WEB  = /^https?:\/\/\S+$/i;

const REGLAS_EMPRESA = {
    nombre_comercial: { max: 100, obligatorio: true },
    razon_social:     { max: 150 },
    nit:              { max: 20, patron: /^[0-9A-Za-z-]+$/, mensaje: 'El NIT solo admite números, letras y guiones' },
    rubro:            { max: 60 },
    eslogan:          { max: 150 },
    telefono:         { max: 20, patron: TELEFONO, mensaje: 'Teléfono inválido' },
    whatsapp:         { max: 20, patron: TELEFONO, mensaje: 'Número de WhatsApp inválido' },
    correo:           { max: 100, patron: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, mensaje: 'Correo inválido' },
    sitio_web:        { max: 150, patron: URL_WEB, mensaje: 'El sitio web debe empezar con http:// o https://' },
    direccion:        { max: 250 },
    ciudad:           { max: 60 },
    pais:             { max: 60 },
    facebook:         { max: 150, patron: URL_WEB, mensaje: 'El enlace de Facebook debe empezar con https://' },
    instagram:        { max: 150, patron: URL_WEB, mensaje: 'El enlace de Instagram debe empezar con https://' },
    tiktok:           { max: 150, patron: URL_WEB, mensaje: 'El enlace de TikTok debe empezar con https://' }
};

const ETIQUETAS = {
    nombre_comercial: 'nombre comercial', razon_social: 'razón social', sitio_web: 'sitio web',
    direccion: 'dirección', pais: 'país'
};

const COLOR = /^#[0-9a-f]{6}$/i;
const TEMAS = ['claro', 'oscuro', 'auto'];

const IMAGENES = {
    logo:    { campo: 'url_logo',    maxBytes: 2 * 1024 * 1024 },
    favicon: { campo: 'url_favicon', maxBytes: 512 * 1024 }
};

class ErrorValidacion extends Error {}

/** Texto vacío → NULL; valida longitud y formato. */
const validarEmpresa = (body) => {
    const datos = {};
    for (const [campo, regla] of Object.entries(REGLAS_EMPRESA)) {
        if (!(campo in body)) continue;
        const valor = body[campo] == null ? '' : String(body[campo]).trim();
        const nombre = ETIQUETAS[campo] || campo;
        if (!valor) {
            if (regla.obligatorio) throw new ErrorValidacion(`El ${nombre} es obligatorio`);
            datos[campo] = null;
            continue;
        }
        if (valor.length > regla.max) throw new ErrorValidacion(`El campo ${nombre} admite hasta ${regla.max} caracteres`);
        if (regla.patron && !regla.patron.test(valor)) throw new ErrorValidacion(regla.mensaje);
        datos[campo] = valor;
    }
    return datos;
};

const validarApariencia = (body) => {
    const datos = {};
    for (const campo of ['color_primario', 'color_secundario']) {
        if (!(campo in body)) continue;
        const valor = body[campo] ? String(body[campo]).trim().toLowerCase() : null;
        if (valor && !COLOR.test(valor)) throw new ErrorValidacion('Color inválido: use el formato #RRGGBB');
        datos[campo] = valor;
    }
    if ('tema' in body) {
        if (!TEMAS.includes(body.tema)) throw new ErrorValidacion('Tema inválido');
        datos.tema = body.tema;
    }
    // Imagen nueva (data URI) o null para quitarla
    for (const [clave, { campo, maxBytes }] of Object.entries(IMAGENES)) {
        if (!(clave in body)) continue;
        if (body[clave] === null) { datos[campo] = null; continue; }
        try {
            datos[campo] = guardarImagen(body[clave], { carpeta: 'empresa', prefijo: clave, maxBytes });
        } catch (e) {
            throw new ErrorValidacion(e.message);
        }
    }
    return datos;
};

// ─── Parámetros ───
const ENTEROS = {
    menu_minutos_expiracion:  { min: 5, max: 120,   nombre: 'Vencimiento de pedidos sin confirmar (minutos)' },
    menu_max_pendientes_mesa: { min: 1, max: 10,    nombre: 'Pedidos pendientes por mesa' },
    menu_max_pedidos_ip:      { min: 1, max: 100,   nombre: 'Pedidos por dispositivo cada 10 minutos' },
    stock_minimo_defecto:     { min: 0, max: 10000, nombre: 'Stock mínimo por defecto' },
    login_max_intentos:       { min: 3, max: 20,    nombre: 'Intentos de inicio de sesión' },
    login_minutos_bloqueo:    { min: 1, max: 1440,  nombre: 'Minutos de bloqueo' },
    sesion_horas:             { min: 1, max: 24,    nombre: 'Duración de la sesión (horas)' }
};
const BOOLEANOS = ['pago_efectivo', 'pago_qr', 'menu_activo', 'captcha_activo'];
const TEXTOS = {
    moneda_simbolo:          { max: 5,   obligatorio: true, nombre: 'símbolo de moneda' },
    ticket_mensaje_pie:      { max: 150, obligatorio: true, nombre: 'mensaje del pie del ticket' },
    menu_mensaje_bienvenida: { max: 200, nombre: 'mensaje de bienvenida' }
};

const validarParametros = (body) => {
    const datos = {};
    for (const [campo, r] of Object.entries(ENTEROS)) {
        if (!(campo in body)) continue;
        const n = Number(body[campo]);
        if (!Number.isInteger(n) || n < r.min || n > r.max)
            throw new ErrorValidacion(`${r.nombre}: debe ser un número entero entre ${r.min} y ${r.max}`);
        datos[campo] = n;
    }
    for (const campo of BOOLEANOS) {
        if (!(campo in body)) continue;
        if (typeof body[campo] !== 'boolean') throw new ErrorValidacion(`Valor inválido en ${campo}`);
        datos[campo] = body[campo];
    }
    for (const [campo, r] of Object.entries(TEXTOS)) {
        if (!(campo in body)) continue;
        const valor = body[campo] == null ? '' : String(body[campo]).trim();
        if (!valor && r.obligatorio) throw new ErrorValidacion(`El ${r.nombre} es obligatorio`);
        if (valor.length > r.max) throw new ErrorValidacion(`El ${r.nombre} admite hasta ${r.max} caracteres`);
        datos[campo] = valor || null;
    }
    return datos;
};

// Se valida contra lo guardado: al menos un método de pago queda activo
const validarParametrosCompletos = async (body) => {
    const datos = validarParametros(body);
    const actual = await ajusteModel.obtener();
    const efectivo = datos.pago_efectivo ?? actual.pago_efectivo;
    const qr       = datos.pago_qr ?? actual.pago_qr;
    if (!efectivo && !qr) throw new ErrorValidacion('Debe quedar al menos un método de pago habilitado');
    if ('qr_cobro' in body) {
        if (body.qr_cobro === null) datos.url_qr_cobro = null;
        else {
            try {
                datos.url_qr_cobro = guardarImagen(body.qr_cobro, { carpeta: 'empresa', prefijo: 'qr-cobro', maxBytes: 2 * 1024 * 1024 });
            } catch (e) {
                throw new ErrorValidacion(e.message);
            }
        }
    }
    return datos;
};

const avisarCambio = async () => {
    global.io?.emit('ajustes:actualizados', await ajusteModel.obtenerPublico());
};

const guardar = (validar, permitidos) => async (req, res) => {
    try {
        const datos = await validar(req.body || {});
        const config = await ajusteModel.actualizar(datos, permitidos);
        await avisarCambio();
        res.json({ mensaje: 'Ajustes guardados', configuracion: config });
    } catch (e) {
        if (e instanceof ErrorValidacion) return res.status(400).json({ error: e.message });
        console.error('Error al guardar ajustes:', e);
        res.status(500).json({ error: 'No se pudieron guardar los ajustes' });
    }
};

// ─── Endpoints ───
const obtenerPublico = async (req, res) => {
    try {
        res.json(await ajusteModel.obtenerPublico());
    } catch (e) {
        console.error('Error al obtener ajustes públicos:', e);
        res.status(500).json({ error: 'No se pudieron obtener los ajustes' });
    }
};

const obtener = async (req, res) => {
    try {
        res.json(await ajusteModel.obtener());
    } catch (e) {
        console.error('Error al obtener ajustes:', e);
        res.status(500).json({ error: 'No se pudieron obtener los ajustes' });
    }
};

const guardarEmpresa    = guardar(validarEmpresa,    ajusteModel.CAMPOS_EMPRESA);
const guardarApariencia = guardar(validarApariencia, ajusteModel.CAMPOS_APARIENCIA);
const guardarParametros = guardar(validarParametrosCompletos, ajusteModel.CAMPOS_PARAMETROS);

module.exports = { obtenerPublico, obtener, guardarEmpresa, guardarApariencia, guardarParametros };
