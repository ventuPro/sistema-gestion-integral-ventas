const ajusteModel = require('../models/ajusteModel');
const { guardarImagen, borrarImagen } = require('../utils/imagenes');
const groq = require('../ia/groq');
const telegramApi = require('../utils/telegram');
const QRCode = require('qrcode');
const db = require('../config/db');
const telegramModel = require('../models/telegramModel');
const { ErrorValidacion, revisar, sinSentido } = require('../utils/validacion');

// ─── Reglas de validación (utils/validacion.js) ───
const REGLAS_EMPRESA = {
    nombre_comercial: { regla: 'nombre',    max: 100, obligatorio: true, etiqueta: 'El nombre comercial' },
    razon_social:     { regla: 'nombre',    max: 150, etiqueta: 'La razón social' },
    nit:              { regla: 'nit',       etiqueta: 'El NIT' },
    rubro:            { regla: 'texto',     max: 60,  etiqueta: 'El rubro' },
    eslogan:          { regla: 'texto',     max: 150, etiqueta: 'El eslogan' },
    telefono:         { regla: 'telefono',  etiqueta: 'El teléfono' },
    whatsapp:         { regla: 'celular',   etiqueta: 'El WhatsApp' },
    correo:           { regla: 'correo',    max: 100, etiqueta: 'El correo' },
    sitio_web:        { regla: 'url',       max: 150, etiqueta: 'El sitio web' },
    direccion:        { regla: 'direccion', max: 250, etiqueta: 'La dirección' },
    ciudad:           { regla: 'letras',    max: 60,  etiqueta: 'La ciudad' },
    pais:             { regla: 'letras',    max: 60,  etiqueta: 'El país' },
    facebook:         { regla: 'url',       max: 150, etiqueta: 'El enlace de Facebook' },
    instagram:        { regla: 'url',       max: 150, etiqueta: 'El enlace de Instagram' },
    tiktok:           { regla: 'url',       max: 150, etiqueta: 'El enlace de TikTok' },
    login_titulo:     { regla: 'texto',     max: 100, etiqueta: 'El texto del inicio de sesión' }
};

const COLOR = /^#[0-9a-f]{6}$/i;
const TEMAS = ['claro', 'oscuro', 'auto'];

const IMAGENES = {
    logo:    { campo: 'url_logo',    maxBytes: 2 * 1024 * 1024 },
    favicon: { campo: 'url_favicon', maxBytes: 512 * 1024 }
};

/** Texto vacío → NULL; valida longitud y formato. */
const validarEmpresa = (body) => {
    const datos = {};
    for (const [campo, r] of Object.entries(REGLAS_EMPRESA))
        if (campo in body) datos[campo] = revisar(body[campo], r.regla, r);
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
    menu_visita_horas:        { min: 1, max: 12,    nombre: 'Duración máxima de la visita (horas)' },
    menu_visita_inactividad:  { min: 10, max: 240,  nombre: 'Fin de la visita por inactividad (minutos)' },
    menu_bloqueo_horas:       { min: 1, max: 72,    nombre: 'Bloqueo por pedido falso (horas)' },
    stock_minimo_defecto:     { min: 0, max: 10000, nombre: 'Stock mínimo' },
    vida_util_elaborado_horas: { min: 1, max: 8760, nombre: 'Vida útil de lo elaborado (horas)' },
    vida_util_comprado_dias:   { min: 1, max: 3650, nombre: 'Vida útil de lo comprado (días)' },
    aviso_vence_elaborado_horas: { min: 1, max: 720, nombre: 'Aviso de por vencer de lo elaborado (horas antes)' },
    aviso_vence_comprado_dias:   { min: 1, max: 365, nombre: 'Aviso de por vencer de lo comprado (días antes)' },
    login_max_intentos:       { min: 3, max: 20,    nombre: 'Intentos de inicio de sesión' },
    login_minutos_bloqueo:    { min: 1, max: 1440,  nombre: 'Minutos de bloqueo' },
    sesion_horas:             { min: 1, max: 24,    nombre: 'Duración de la sesión (horas)' }
};
const BOOLEANOS = ['pago_efectivo', 'pago_qr', 'menu_activo', 'menu_qr_visita', 'captcha_activo'];
const TEXTOS = {
    moneda_simbolo:          { regla: 'moneda', max: 5,   obligatorio: true, etiqueta: 'El símbolo de moneda' },
    ticket_mensaje_pie:      { regla: 'texto',  max: 150, obligatorio: true, etiqueta: 'El mensaje del pie del ticket' },
    menu_mensaje_bienvenida: { regla: 'texto',  max: 200, etiqueta: 'El mensaje de bienvenida', multilinea: true }
};

const OPCIONES = {
    ticket_ancho: { valores: ['58', '80', 'A4'], nombre: 'Ancho del ticket' }
};

const validarParametros = (body) => {
    const datos = {};
    for (const [campo, r] of Object.entries(OPCIONES)) {
        if (!(campo in body)) continue;
        if (!r.valores.includes(body[campo])) throw new ErrorValidacion(`${r.nombre}: valor inválido`);
        datos[campo] = body[campo];
    }
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
    for (const [campo, r] of Object.entries(TEXTOS))
        if (campo in body) datos[campo] = revisar(body[campo], r.regla, r);
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

// ─── Chatbot ───
const MAX_INFO_IA = 3000;

const validarIa = (body) => {
    const datos = {};
    if ('ia_info_negocio' in body) {
        const valor = body.ia_info_negocio == null ? '' : String(body.ia_info_negocio).trim();
        if (valor.length > MAX_INFO_IA) throw new ErrorValidacion(`La información para el chatbot admite hasta ${MAX_INFO_IA} caracteres`);
        const absurdo = sinSentido(valor, 'texto');
        if (absurdo) throw new ErrorValidacion(`La información para el chatbot ${absurdo}`);
        datos.ia_info_negocio = valor || null;
    }
    return datos;
};

const avisarCambio = async () => {
    global.io?.emit('ajustes:actualizados', await ajusteModel.obtenerPublico());
};

const guardar = (validar, permitidos) => async (req, res) => {
    try {
        const datos = await validar(req.body || {});
        const antes = await ajusteModel.obtener();
        const config = await ajusteModel.actualizar(datos, permitidos);
        for (const campo of ['url_logo', 'url_favicon', 'url_qr_cobro'])
            if (campo in datos && antes[campo] !== config[campo]) borrarImagen(antes[campo]);
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
const guardarIa         = guardar(validarIa, ajusteModel.CAMPOS_IA);

// POST /api/ajustes/ia/probar → responde cada asistente con el modelo que le tocó
const probarIa = async (req, res) => {
    if (!groq.disponible()) return res.status(503).json({ error: 'Falta la clave de Groq (GROQ_API_KEY) en el archivo .env del servidor.', codigo: 'SIN_CLAVE' });
    try {
        res.json(await groq.probar());
    } catch (e) {
        groq.responderError(res, e, 'probarIa');
    }
};

// ─── Telegram: teléfono, vínculo y sucursal de avisos de cada usuario ───
const ERRORES_TELEGRAM = { INVALIDO: 400, OCUPADO: 409, NO_EXISTE: 404 };

const telegram = async (req, res) => {
    try {
        let bot = null, enlace = null, qr = null, error = null;
        if (telegramApi.activo()) {
            try {
                bot = (await telegramApi.datosBot()).username;
                enlace = `https://t.me/${bot}`;
                qr = await QRCode.toDataURL(enlace, { margin: 1, width: 240 });
            } catch (e) { error = `Telegram no respondió: ${e.message}`; }
        }
        const sucursales = (await db.query(
            `SELECT id_sucursal, nombre_sucursal FROM sucursal WHERE estado_activo = TRUE ORDER BY id_sucursal`)).rows;
        res.json({ activo: telegramApi.activo(), bot, enlace, qr, error, sucursales, usuarios: await telegramModel.listar() });
    } catch (e) {
        console.error('telegram:', e);
        res.status(500).json({ error: 'No se pudo cargar Telegram' });
    }
};

const guardarTelegramUsuario = async (req, res) => {
    try {
        const { telefono, avisos_telegram, avisos_sucursal } = req.body || {};
        await telegramModel.actualizar(Number(req.params.id), { telefono, avisos_telegram, avisos_sucursal: Number(avisos_sucursal) || null });
        res.json({ mensaje: 'Guardado', usuarios: await telegramModel.listar() });
    } catch (e) {
        if (ERRORES_TELEGRAM[e.codigo]) return res.status(ERRORES_TELEGRAM[e.codigo]).json({ error: e.message });
        console.error('guardarTelegramUsuario:', e);
        res.status(500).json({ error: 'No se pudo guardar' });
    }
};

const probarTelegramUsuario = async (req, res) => {
    const u = await telegramModel.chatDe(Number(req.params.id)).catch(() => null);
    if (!u?.telegram_chat_id) return res.status(400).json({ error: 'Ese usuario todavía no vinculó su Telegram' });
    try {
        const nombre = (await ajusteModel.obtener())?.nombre_comercial || 'el sistema';
        await telegramApi.enviar(u.telegram_chat_id, `Mensaje de prueba de ${nombre}: los avisos llegarán a este chat.`);
        res.json({ mensaje: 'Mensaje de prueba enviado' });
    } catch (e) {
        res.status(502).json({ error: `Telegram no respondió: ${e.message}` });
    }
};

const desvincularTelegramUsuario = async (req, res) => {
    try {
        await telegramModel.desvincular(Number(req.params.id));
        res.json({ mensaje: 'Telegram desvinculado', usuarios: await telegramModel.listar() });
    } catch (e) {
        console.error('desvincularTelegramUsuario:', e);
        res.status(500).json({ error: 'No se pudo desvincular' });
    }
};

module.exports = { obtenerPublico, obtener, guardarEmpresa, guardarApariencia, guardarParametros,
                   guardarIa, probarIa,
                   telegram, guardarTelegramUsuario, probarTelegramUsuario, desvincularTelegramUsuario };
