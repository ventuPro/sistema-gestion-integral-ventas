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

const avisarCambio = async () => {
    global.io?.emit('ajustes:actualizados', await ajusteModel.obtenerPublico());
};

const guardar = (validar, permitidos) => async (req, res) => {
    try {
        const datos = validar(req.body || {});
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

module.exports = { obtenerPublico, obtener, guardarEmpresa, guardarApariencia };
