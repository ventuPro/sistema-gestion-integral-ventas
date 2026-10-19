const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin }    = require('../sesionPrueba');

// ─── Chatbots: ajustes y conexión con Groq ───
// Se usa un Groq falso: las pruebas no gastan el cupo ni necesitan internet.
process.env.GROQ_API_KEY = 'clave-de-prueba';

let bd, servidor, io, pool, URL_BASE, tokenAdmin, tokenCajero, groqFalso, codigoMesa;
const recibidas = [];
const saturados = new Set();   // modelos que el Groq falso responde con 429

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
};

const login = crearLogin((...a) => api(...a));

const responder = (res, estado, datos, cabeceras = {}) => {
    res.writeHead(estado, { 'Content-Type': 'application/json', ...cabeceras });
    res.end(JSON.stringify(datos));
};

const iniciarGroqFalso = () => new Promise((listo) => {
    groqFalso = http.createServer((req, res) => {
        if (req.headers.authorization !== 'Bearer clave-de-prueba')
            return responder(res, 401, { error: { message: 'Invalid API Key' } });
        let cuerpo = '';
        req.on('data', d => cuerpo += d);
        req.on('end', () => {
            const datos = JSON.parse(cuerpo);
            recibidas.push(datos);
            if (saturados.has(datos.model))
                return responder(res, 429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '1' });
            const ultimo = datos.messages.at(-1);
            if (ultimo.role === 'tool')
                return responder(res, 200, { choices: [{ message: { role: 'assistant', content: `Resultado: ${ultimo.content}` } }] });
            const pedida = /\[funcion:(\w+)\s*(\{.*\})?\]/.exec(ultimo.content);
            if (pedida)
                return responder(res, 200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
                    id: 'llamada1', type: 'function', function: { name: pedida[1], arguments: pedida[2] || '{}' } }] } }] });
            responder(res, 200, { choices: [{ message: { role: 'assistant', content: 'Hola, estoy funcionando.' } }],
                                  usage: { total_tokens: 12 } });
        });
    });
    groqFalso.listen(0, '127.0.0.1', () => {
        process.env.GROQ_URL = `http://127.0.0.1:${groqFalso.address().port}`;
        listo();
    });
});

before(async () => {
    await iniciarGroqFalso();
    bd = await crearBdPrueba();
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    const hash = await bcrypt.hash('Prueba123', 4);
    await bd.sql(`INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
                  VALUES (1, 2, 'Cajero IA', 'cajero.ia@prueba.com', $1)`, [hash]);
    tokenAdmin  = await login('admin@rickys.com', 'password');
    tokenCajero = await login('cajero.ia@prueba.com', 'Prueba123');
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Tortas IA')`);
    for (const [nombre, precio, cantidad] of [['Torta de chocolate IA', 45, 10], ['Pie de limón IA', 20, 0]]) {
        const [p] = await bd.sql(`INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
            VALUES ((SELECT max(id_categoria) FROM categoria_producto), $1, $2) RETURNING id_producto`, [nombre, precio]);
        await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES (1, $1, $2)`,
                     [p.id_producto, cantidad]);
    }
    codigoMesa  = (await bd.sql(`INSERT INTO mesa_local (id_sucursal, numero_mesa, codigo_qr)
                                VALUES (1, 99, md5(random()::text)) RETURNING codigo_qr`))[0].codigo_qr;
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
    if (groqFalso) groqFalso.close();
});

test('los chatbots están siempre activos con la clave y su información no es pública', async () => {
    const r = await api('GET', '/ajustes/publico');
    assert.equal(r.body.ia_cliente_disponible, true);
    assert.equal(r.body.ia_interno_disponible, true);
    assert.equal(r.body.ia_info_negocio, undefined);
});

test('solo el administrador configura el chatbot', async () => {
    assert.equal((await api('PUT', '/ajustes/ia', { token: tokenCajero, body: { ia_info_negocio: 'x' } })).status, 403);
    assert.equal((await api('POST', '/ajustes/ia/probar', {})).status, 401);
});

test('la información para el chatbot admite hasta 3000 caracteres', async () => {
    const largo = await api('PUT', '/ajustes/ia', { token: tokenAdmin, body: { ia_info_negocio: 'x'.repeat(3001) } });
    assert.equal(largo.status, 400);
    const justo = await api('PUT', '/ajustes/ia', { token: tokenAdmin, body: { ia_info_negocio: 'x'.repeat(3000) } });
    assert.equal(justo.status, 200);

    const r = await api('PUT', '/ajustes/ia', { token: tokenAdmin, body: {
        ia_info_negocio: '  Hacemos tortas por encargo con 2 días de anticipación.  ' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.configuracion.ia_info_negocio, 'Hacemos tortas por encargo con 2 días de anticipación.');
});

test('probar conexión responde con cada asistente y razonamiento bajo en gpt-oss', async () => {
    const r = await api('POST', '/ajustes/ia/probar', { token: tokenAdmin });
    assert.equal(r.status, 200);
    assert.equal(r.body.cliente.texto, 'Hola, estoy funcionando.');
    assert.equal(r.body.cliente.modelo, 'openai/gpt-oss-20b');
    assert.equal(r.body.interno.modelo, 'openai/gpt-oss-120b');
    const enviada = recibidas.at(-1);
    assert.equal(enviada.reasoning_effort, 'low');
    assert.equal(enviada.include_reasoning, false);
});

// ─── Asistente del menú QR ───
const CELULAR = 'a'.repeat(32);
const preguntar = (mensajes, cliente_mesa = CELULAR) =>
    api('POST', `/menu/m/${codigoMesa}/asistente`, { body: { mensajes, cliente_mesa } });

test('el asistente del menú responde con la carta real y la información del propietario', async () => {
    const r = await preguntar([
        { rol: 'usuario', texto: 'Hola' },
        { rol: 'asistente', texto: '¡Hola! ¿En qué te ayudo?' },
        { rol: 'usuario', texto: '¿Qué me recomiendas?' }
    ]);
    assert.equal(r.status, 200);
    assert.equal(r.body.respuesta, 'Hola, estoy funcionando.');

    const enviada = recibidas.at(-1);
    const sistema = enviada.messages[0].content;
    assert.ok(sistema.includes('Torta de chocolate IA: 45.00'));
    assert.ok(sistema.includes('Pie de limón IA: 20.00 AGOTADO'));
    assert.ok(sistema.includes('INFORMACIÓN DEL PROPIETARIO'));
    assert.ok(sistema.includes('Hacemos tortas por encargo'));
    assert.deepEqual(enviada.messages.slice(1).map(m => m.role), ['user', 'assistant', 'user']);
});

test('rechaza conversaciones vacías o que no terminan en una pregunta', async () => {
    for (const mensajes of [[], 'hola', [{ rol: 'asistente', texto: 'Hola' }], [{ rol: 'usuario', texto: '   ' }]])
        assert.equal((await preguntar(mensajes)).status, 400, JSON.stringify(mensajes));
});

test('si un modelo está saturado se usa otro y se aparta mientras dura el límite', async () => {
    saturados.add('openai/gpt-oss-20b');
    try {
        const r = await preguntar([{ rol: 'usuario', texto: '¿Tienen tortas?' }]);
        assert.equal(r.status, 200);
        assert.equal(recibidas.at(-2).model, 'openai/gpt-oss-20b');
        assert.equal(recibidas.at(-1).model, 'qwen/qwen3.8-27b');

        // La siguiente pregunta ya no intenta con el saturado
        const antes = recibidas.length;
        await preguntar([{ rol: 'usuario', texto: '¿Y pies?' }]);
        assert.deepEqual(recibidas.slice(antes).map(x => x.model), ['qwen/qwen3.8-27b']);
    } finally {
        saturados.clear();
    }
});

test('si todos los modelos están saturados se avisa sin error de servidor', async () => {
    for (const m of ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b']) saturados.add(m);
    try {
        const r = await preguntar([{ rol: 'usuario', texto: '¿Qué hay?' }]);
        assert.equal(r.status, 429);
        assert.equal(r.body.codigo, 'OCUPADO');
    } finally {
        saturados.clear();
        await new Promise(r => setTimeout(r, 1100));   // retry-after del Groq falso
    }
});

test('limita las preguntas por celular y no a los demás celulares del mismo WiFi', async () => {
    process.env.IA_LIMITE_CLIENTE = '1';
    try {
        const otro = 'b'.repeat(32);
        assert.equal((await preguntar([{ rol: 'usuario', texto: 'Hola' }], otro)).status, 200);
        const r = await preguntar([{ rol: 'usuario', texto: '¿Hasta qué hora atienden?' }], otro);
        assert.equal(r.status, 429);
        assert.equal(r.body.codigo, 'LIMITE');
        assert.equal((await preguntar([{ rol: 'usuario', texto: 'Hola' }], 'c'.repeat(32))).status, 200);
    } finally {
        delete process.env.IA_LIMITE_CLIENTE;
    }
});

// ─── Asistente del personal ───
const consultar = (token, texto) => api('POST', '/asistente', { token, body: { mensajes: [{ rol: 'usuario', texto }] } });
const funcionesOfrecidas = () => (recibidas.at(-1).tools || []).map(t => t.function.name).sort();
const resultado = (r) => JSON.parse(r.body.respuesta.replace(/^Resultado: /, ''));

test('el asistente del personal exige sesión', async () => {
    assert.equal((await api('POST', '/asistente', { body: { mensajes: [{ rol: 'usuario', texto: 'Hola' }] } })).status, 401);
});

test('al cajero solo se le ofrecen las funciones de sus permisos', async () => {
    assert.equal((await consultar(tokenCajero, 'Hola')).status, 200);
    assert.deepEqual(funcionesOfrecidas(), ['ayuda_sistema', 'consultar_stock', 'estado_caja', 'pedidos_qr', 'promociones_vigentes', 'ventas_de_hoy']);
    const temas = recibidas.at(-1).tools.find(t => t.function.name === 'ayuda_sistema').function.parameters.properties.tema.enum;
    assert.ok(!temas.includes('ajustes') && !temas.includes('usuarios') && temas.includes('arqueo'));

    await consultar(tokenAdmin, 'Hola');
    assert.ok(funcionesOfrecidas().includes('informe_periodo'));
    assert.ok(funcionesOfrecidas().includes('listar_sucursales'));
});

test('el cajero solo consulta su sucursal aunque el modelo pida otra', async () => {
    const [s2] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sucursal IA 2') RETURNING id_sucursal`);
    const [p] = await bd.sql(`INSERT INTO producto (id_categoria, nombre_producto, precio_unitario)
        VALUES ((SELECT max(id_categoria) FROM categoria_producto), 'Solo en sucursal 2', 9) RETURNING id_producto`);
    await bd.sql(`INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual) VALUES ($1, $2, 7)`,
                 [s2.id_sucursal, p.id_producto]);

    const r = await consultar(tokenCajero, `[funcion:consultar_stock {"id_sucursal": ${s2.id_sucursal}}]`);
    assert.equal(r.status, 200);
    const nombres = resultado(r).productos.map(x => x.producto);
    assert.ok(nombres.includes('Torta de chocolate IA'));
    assert.ok(!nombres.includes('Solo en sucursal 2'));

    const a = await consultar(tokenAdmin, `[funcion:consultar_stock {"id_sucursal": ${s2.id_sucursal}}]`);
    assert.deepEqual(resultado(a).productos.map(x => x.producto), ['Solo en sucursal 2']);
});

test('una función que su rol no tiene no se ejecuta', async () => {
    const r = await consultar(tokenCajero, '[funcion:informe_periodo {"fecha_inicio": "2026-01-01", "fecha_fin": "2026-01-31"}]');
    assert.equal(r.status, 200);
    assert.deepEqual(resultado(r), { error: 'Función no disponible' });
});

test('los datos inválidos de una función vuelven al modelo como error', async () => {
    const r = await consultar(tokenAdmin, '[funcion:informe_periodo {"fecha_inicio": "ayer", "fecha_fin": "hoy"}]');
    assert.equal(r.status, 200);
    assert.match(resultado(r).error, /Fechas inválidas/);
});

test('cada consulta queda en la auditoría como IA_CONSULTA', async () => {
    await consultar(tokenCajero, '¿Cómo cierro mi caja?');
    await new Promise(r => setTimeout(r, 200));
    const [fila] = await bd.sqlAuditoria(
        `SELECT detalle FROM registro_acceso WHERE evento = 'IA_CONSULTA' ORDER BY id_acceso DESC LIMIT 1`);
    assert.equal(fila.detalle.asistente, 'interno');
    assert.equal(fila.detalle.pregunta, '¿Cómo cierro mi caja?');
});

test('limita las preguntas por usuario', async () => {
    process.env.IA_LIMITE_INTERNO = '1';
    try {
        const r = await consultar(tokenCajero, '¿Cuánto vendí hoy?');
        assert.equal(r.status, 429);
        assert.equal(r.body.codigo, 'LIMITE');
    } finally {
        delete process.env.IA_LIMITE_INTERNO;
    }
});
