// ─── Cliente de Groq (API compatible con OpenAI) ───
// Solo el backend habla con Groq; la clave está en .env (GROQ_API_KEY).
// GROQ_URL permite apuntar a un servidor falso en las pruebas.
const URL_API   = () => process.env.GROQ_URL || 'https://api.groq.com/openai/v1';
const TIEMPO_MS = 25 * 1000;

const MENSAJES = {
    SIN_CLAVE:       'El asistente no está configurado (falta la clave de Groq en el servidor).',
    CLAVE_INVALIDA:  'La clave de Groq no es válida. Revísala en el archivo .env del servidor.',
    OCUPADO:         'El asistente está ocupado en este momento. Intenta de nuevo en un minuto.',
    SIN_CONEXION:    'No se pudo conectar con el servicio de IA. Revisa la conexión a internet.',
    MODELO_INVALIDO: 'El modelo de IA no está disponible en Groq.',
    ERROR:           'El asistente no pudo responder. Intenta de nuevo.'
};

class ErrorIA extends Error {
    constructor(codigo, esperarMs = 0) {
        super(MENSAJES[codigo] || MENSAJES.ERROR);
        this.codigo = codigo;
        this.esperarMs = esperarMs;
    }
}

const disponible = () => !!process.env.GROQ_API_KEY;

const ESTADOS = { SIN_CLAVE: 503, CLAVE_INVALIDA: 502, OCUPADO: 429, SIN_CONEXION: 502, MODELO_INVALIDO: 400, ERROR: 502 };

/** Responde el error de IA con su mensaje; los demás errores, como 500 */
// El sistema no muestra emojis: se quitan aunque el modelo los ponga
const sinEmojis = (texto) => texto.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]+ ?/gu, '').trim();

const responderError = (res, e, contexto) => {
    if (e instanceof ErrorIA) return res.status(ESTADOS[e.codigo]).json({ error: e.message, codigo: e.codigo });
    console.error(`${contexto}:`, e);
    res.status(500).json({ error: MENSAJES.ERROR });
};

const peticion = async (ruta, cuerpo) => {
    if (!disponible()) throw new ErrorIA('SIN_CLAVE');
    let r;
    try {
        r = await fetch(URL_API() + ruta, {
            method:  cuerpo ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body:    cuerpo ? JSON.stringify(cuerpo) : undefined,
            signal:  AbortSignal.timeout(TIEMPO_MS)
        });
    } catch {
        throw new ErrorIA('SIN_CONEXION');
    }
    const datos = await r.json().catch(() => ({}));
    if (r.ok) return datos;

    const detalle = datos.error?.message || '';
    if (r.status === 401 || r.status === 403) throw new ErrorIA('CLAVE_INVALIDA');
    if (r.status === 429 || r.status === 498 || r.status === 503)
        throw new ErrorIA('OCUPADO', (Number(r.headers.get('retry-after')) || 20) * 1000);
    if (r.status === 404 || /model.*(not exist|not found|decommissioned)/i.test(detalle)) throw new ErrorIA('MODELO_INVALIDO');
    // El modelo armó mal una llamada a función: vale la pena reintentar
    if (r.status === 400 && /tool call validation|tool_use_failed|failed to call a function/i.test(detalle)) throw new ErrorIA('FUNCION_INVALIDA');
    console.error(`Groq ${r.status}:`, detalle);
    throw new ErrorIA('ERROR');
};

// Los gpt-oss razonan antes de responder; en "low" gastan menos cupo
const opcionesModelo = (modelo) =>
    modelo.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {};

// ─── Elección automática del modelo ───
// El cupo gratuito es por modelo (≈ 8000 tokens por minuto cada uno): se usa el
// preferido de cada asistente y, si está saturado, el siguiente. Un modelo
// saturado se aparta el tiempo que indica Groq; uno retirado, una hora.
const MODELOS = {
    cliente: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
    interno: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
};
const apartados = new Map();   // modelo → hasta cuándo no se usa

const apartar = (modelo, ms) => apartados.set(modelo, Date.now() + Math.min(ms, 60 * 60 * 1000));

/** Libres primero; si todos están apartados, el que se libera antes */
const ordenar = (lista) => {
    const ahora = Date.now();
    const hasta = (m) => apartados.get(m) || 0;
    const libres = lista.filter(m => hasta(m) <= ahora);
    return libres.length ? libres : [...lista].sort((a, b) => hasta(a) - hasta(b)).slice(0, 1);
};

const completar = async (perfil, cuerpo) => {
    let error = 'OCUPADO';
    for (const modelo of ordenar(MODELOS[perfil] || MODELOS.cliente)) {
        for (let intento = 1; intento <= 2; intento++) {
            try {
                const r = await peticion('/chat/completions', { ...cuerpo, model: modelo, ...opcionesModelo(modelo) });
                apartados.delete(modelo);
                return { ...r, modelo };
            } catch (e) {
                // El modelo armó mal una llamada a función: se reintenta una vez
                if (e.codigo === 'FUNCION_INVALIDA' && intento === 1) continue;
                if (e.codigo === 'FUNCION_INVALIDA') { error = 'ERROR'; break; }
                if (e.codigo === 'OCUPADO')         { apartar(modelo, e.esperarMs); break; }
                if (e.codigo === 'MODELO_INVALIDO') { apartar(modelo, 60 * 60 * 1000); error = 'ERROR'; break; }
                throw e;
            }
        }
    }
    throw new ErrorIA(error);
};

/**
 * Conversación con funciones de solo lectura: el modelo pide datos, se ejecutan
 * aquí y se le devuelven hasta que responde con texto.
 * herramientas = { nombre: { descripcion, parametros, ejecutar(args) } }
 */
const conversar = async ({ perfil = 'cliente', sistema, mensajes, herramientas = {}, maxTokens = 700, maxVueltas = 4 }) => {
    const historial = [{ role: 'system', content: sistema }, ...mensajes];
    const tools = Object.entries(herramientas).map(([name, h]) => ({
        type: 'function',
        function: { name, description: h.descripcion, parameters: h.parametros || { type: 'object', properties: {} } }
    }));
    const usadas = [];
    let tokens = 0;

    for (let vuelta = 1; vuelta <= maxVueltas; vuelta++) {
        const r = await completar(perfil, {
            messages: historial, max_tokens: maxTokens, temperature: 0.3,
            ...(tools.length ? { tools, tool_choice: vuelta === maxVueltas ? 'none' : 'auto' } : {})
        });
        tokens += r.usage?.total_tokens || 0;
        const m = r.choices?.[0]?.message || {};
        if (!m.tool_calls?.length)
            return { texto: sinEmojis(m.content || '') || 'No tengo una respuesta para eso.', herramientas: usadas, tokens, modelo: r.modelo };

        historial.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
        for (const llamada of m.tool_calls) {
            const nombre = llamada.function?.name;
            const h = herramientas[nombre];
            let resultado;
            try {
                if (!h) throw Object.assign(new Error('Función no disponible'), { publico: true });
                resultado = await h.ejecutar(JSON.parse(llamada.function.arguments || '{}'));
                usadas.push(nombre);
            } catch (e) {
                if (!e.publico) console.error(`IA herramienta ${nombre}:`, e.message);
                resultado = { error: e.publico ? e.message : 'No se pudo obtener el dato' };
            }
            historial.push({ role: 'tool', tool_call_id: llamada.id, content: JSON.stringify(resultado).slice(0, 8000) });
        }
    }
    throw new ErrorIA('ERROR');
};

/** Prueba ambos asistentes con una pregunta mínima */
const probar = async () => {
    const prueba = async (perfil) => {
        const inicio = Date.now();
        const r = await conversar({
            perfil, maxTokens: 120,
            sistema: 'Eres el asistente de un sistema de ventas. Responde en español, en una sola frase corta.',
            mensajes: [{ role: 'user', content: 'Saluda y confirma que estás funcionando.' }]
        });
        return { texto: r.texto, modelo: r.modelo, ms: Date.now() - inicio };
    };
    return { cliente: await prueba('cliente'), interno: await prueba('interno') };
};

module.exports = { ErrorIA, disponible, responderError, conversar, probar };
