const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin, resolverCaptcha, tokenDeCookie } = require('../sesionPrueba');

// ─── Telegram: vincular por teléfono, avisos por sucursal y código en cada inicio de sesión ───
// Telegram falso: guarda lo que se le envía; `fallar` simula que no responde.

let bd, servidor, io, pool, URL_BASE, tAdmin, idAdmin, idSur, bot;
const CLAVE = 'Prueba123';
let n = 0;
const enviados = [];
let fallar = false;

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    return { status: r.status, body: datos, headers: r.headers };
};
const iniciarSesion = crearLogin((...a) => api(...a));

const crearUsuario = async ({ id_sucursal = 1, id_rol = 2 } = {}) => {
    const correo = `tg${++n}@prueba.com`;
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_usuario`, [id_sucursal, id_rol, `USUARIO TG ${n}`, correo, await bcrypt.hash(CLAVE, 4)]);
    if (id_rol === 2) await api('PUT', `/permisos/usuario/${u.id_usuario}`, { token: tAdmin,
        body: { permisos: { inventario: true, punto_venta: true, mesas: true, arqueo: true } } });
    return { id: u.id_usuario, correo, id_sucursal };
};

/** Registra el teléfono en Ajustes y simula que la persona lo comparte con el bot */
let chatSiguiente = 5000;
const vincularTelegram = async (u, telefono, avisos_sucursal = null) => {
    const r = await api('PUT', `/ajustes/telegram/usuarios/${u.id}`, { token: tAdmin, body: { telefono, avisos_sucursal } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    u.chat = ++chatSiguiente;
    await bot.procesarActualizacion({ message: { chat: { id: u.chat, type: 'private' }, from: { id: u.chat },
                                                 contact: { phone_number: telefono, user_id: u.chat } } });
    return u;
};

const mensajesA = (chat) => enviados.filter(e => e.metodo === 'sendMessage' && String(e.body.chat_id) === String(chat));
const ultimoCodigo = (chat) => mensajesA(chat).at(-1)?.body.text.match(/: (\d{6})/)?.[1];
const esperar = () => new Promise(r => setTimeout(r, 120));

before(async () => {
    const falso = http.createServer((req, res) => {
        let datos = '';
        req.on('data', c => datos += c);
        req.on('end', () => {
            const metodo = req.url.split('/').pop();
            enviados.push({ metodo, body: datos ? JSON.parse(datos) : {} });
            res.setHeader('Content-Type', 'application/json');
            if (fallar) { res.statusCode = 502; return res.end(JSON.stringify({ ok: false, description: 'Sin conexión' })); }
            const result = metodo === 'getMe' ? { username: 'sgiv_prueba_bot' } : { message_id: enviados.length };
            res.end(JSON.stringify({ ok: true, result }));
        });
    });
    await new Promise(r => falso.listen(0, '127.0.0.1', r));
    falso.unref();
    process.env.TELEGRAM_URL = `http://127.0.0.1:${falso.address().port}`;
    process.env.TELEGRAM_BOT_TOKEN = 'prueba';

    bd = await crearBdPrueba();
    await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Pruebas')`);
    [{ id_sucursal: idSur }] = await bd.sql(`INSERT INTO sucursal (nombre_sucursal) VALUES ('Sur') RETURNING id_sucursal`);
    await bd.sql(`UPDATE configuracion SET stock_minimo_defecto = 3 WHERE id_configuracion = 1`);
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    bot = require('../../src/procesos/telegramBot');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
    tAdmin = await iniciarSesion('admin@rickys.com', 'password');
    [{ id_usuario: idAdmin }] = await bd.sql(`SELECT id_usuario FROM usuario WHERE correo_electronico = 'admin@rickys.com'`);
});

after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_URL;
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

describe('Telegram', () => {
    test('Ajustes → Telegram: solo el administrador; el login sabe que Telegram está activo', async () => {
        const r = await api('GET', '/ajustes/telegram', { token: tAdmin });
        assert.equal(r.status, 200);
        assert.equal(r.body.activo, true);
        assert.equal(r.body.bot, 'sgiv_prueba_bot');
        assert.ok(r.body.usuarios.some(u => u.id_usuario === idAdmin));

        const c = await crearUsuario();
        const tc = await iniciarSesion(c.correo, CLAVE);
        assert.equal((await api('GET', '/ajustes/telegram', { token: tc })).status, 403);
        assert.equal((await api('GET', '/ajustes/publico')).body.telegram_activo, true);
    });

    test('teléfono: se guarda con código de país; repetido → 409; inválido → 400', async () => {
        const a = await crearUsuario();
        const b = await crearUsuario();
        assert.equal((await api('PUT', `/ajustes/telegram/usuarios/${a.id}`, { token: tAdmin, body: { telefono: '7123-4500' } })).status, 200);
        assert.equal((await bd.sql(`SELECT telefono FROM usuario WHERE id_usuario = $1`, [a.id]))[0].telefono, '59171234500');
        const rep = await api('PUT', `/ajustes/telegram/usuarios/${b.id}`, { token: tAdmin, body: { telefono: '+591 71234500' } });
        assert.equal(rep.status, 409);
        assert.match(rep.body.error, /USUARIO TG/);
        assert.equal((await api('PUT', `/ajustes/telegram/usuarios/${b.id}`, { token: tAdmin, body: { telefono: '12' } })).status, 400);
    });

    test('vincular: solo con el número propio y registrado', async () => {
        const u = await crearUsuario();
        await api('PUT', `/ajustes/telegram/usuarios/${u.id}`, { token: tAdmin, body: { telefono: '71110001' } });

        await bot.procesarActualizacion({ message: { chat: { id: 801, type: 'private' }, from: { id: 801 }, text: '/start' } });
        assert.equal(mensajesA(801).at(-1).body.reply_markup.keyboard[0][0].request_contact, true);

        // Contacto de otra persona: no vale
        await bot.procesarActualizacion({ message: { chat: { id: 801, type: 'private' }, from: { id: 801 },
                                                     contact: { phone_number: '59171110001', user_id: 999 } } });
        assert.match(mensajesA(801).at(-1).body.text, /propio número/);
        assert.equal((await bd.sql(`SELECT telegram_chat_id FROM usuario WHERE id_usuario = $1`, [u.id]))[0].telegram_chat_id, null);

        // Número no registrado
        await bot.procesarActualizacion({ message: { chat: { id: 802, type: 'private' }, from: { id: 802 },
                                                     contact: { phone_number: '59179999999', user_id: 802 } } });
        assert.match(mensajesA(802).at(-1).body.text, /no está registrado/);

        await bot.procesarActualizacion({ message: { chat: { id: 801, type: 'private' }, from: { id: 801 },
                                                     contact: { phone_number: '+591 71110001', user_id: 801 } } });
        assert.match(mensajesA(801).at(-1).body.text, /^Listo/);
        const lista = (await api('GET', '/ajustes/telegram', { token: tAdmin })).body.usuarios;
        assert.equal(lista.find(x => x.id_usuario === u.id).vinculado, true);

        // Cambiar el teléfono desvincula
        await api('PUT', `/ajustes/telegram/usuarios/${u.id}`, { token: tAdmin, body: { telefono: '71110002' } });
        assert.equal((await bd.sql(`SELECT telegram_chat_id FROM usuario WHERE id_usuario = $1`, [u.id]))[0].telegram_chat_id, null);
    });

    test('login con Telegram: sin CAPTCHA, código por Telegram, un solo uso', async () => {
        const u = await vincularTelegram(await crearUsuario(), '71110010');
        const r1 = await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } });
        assert.equal(r1.status, 200, JSON.stringify(r1.body));
        assert.equal(r1.body.requiere_codigo, true);
        assert.equal(r1.body.telefono, '010');
        assert.equal(tokenDeCookie(r1.headers), null);
        const codigo = ultimoCodigo(u.chat);
        assert.match(codigo, /^\d{6}$/);

        const mal = await api('POST', '/usuarios/login/codigo', { body: { id_desafio: r1.body.id_desafio, codigo: codigo === '000000' ? '111111' : '000000' } });
        assert.equal(mal.status, 400);
        assert.match(mal.body.error, /Quedan 4/);

        const ok = await api('POST', '/usuarios/login/codigo', { body: { id_desafio: r1.body.id_desafio, codigo } });
        assert.equal(ok.status, 200);
        assert.ok(tokenDeCookie(ok.headers));
        assert.equal(ok.body.usuario.id_usuario, u.id);

        const otraVez = await api('POST', '/usuarios/login/codigo', { body: { id_desafio: r1.body.id_desafio, codigo } });
        assert.equal(otraVez.status, 410);

        // Contraseña incorrecta: no envía código
        const antes = mensajesA(u.chat).length;
        assert.equal((await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: 'mal' } })).status, 401);
        assert.equal(mensajesA(u.chat).length, antes);
    });

    test('5 códigos equivocados bloquean el ingreso', async () => {
        const u = await vincularTelegram(await crearUsuario(), '71110020');
        const r = await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } });
        const malo = ultimoCodigo(u.chat) === '123456' ? '654321' : '123456';
        for (let i = 0; i < 5; i++)
            await api('POST', '/usuarios/login/codigo', { body: { id_desafio: r.body.id_desafio, codigo: malo } });
        assert.equal((await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } })).status, 429);
    });

    test('si Telegram no responde, se entra con el CAPTCHA', async () => {
        const u = await vincularTelegram(await crearUsuario(), '71110030');
        fallar = true;
        const r = await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } });
        fallar = false;
        assert.equal(r.body.requiere_captcha, true);

        assert.equal((await api('POST', '/usuarios/login/alterno',
            { body: { id_desafio: r.body.id_desafio, id_captcha: 'x', captcha: 'y' } })).status, 400);
        const ok = await api('POST', '/usuarios/login/alterno', { body: { id_desafio: r.body.id_desafio, ...resolverCaptcha() } });
        assert.equal(ok.status, 200);
        assert.ok(tokenDeCookie(ok.headers));
        // El paso alterno no sirve para quien sí recibió el código
        const r2 = await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } });
        assert.equal((await api('POST', '/usuarios/login/alterno', { body: { id_desafio: r2.body.id_desafio, ...resolverCaptcha() } })).status, 410);
    });

    test('sin Telegram vinculado: CAPTCHA como siempre', async () => {
        const u = await crearUsuario();
        const r = await api('POST', '/usuarios/login', { body: { correo_electronico: u.correo, contrasena: CLAVE } });
        assert.equal(r.status, 400);
        assert.equal(r.body.codigo, 'CAPTCHA_REQUERIDO');
        assert.ok(await iniciarSesion(u.correo, CLAVE));
    });

    test('avisos: todos al administrador; al cajero los de la sucursal elegida; nunca a quien hizo la acción', async () => {
        const admin = await vincularTelegram({ id: idAdmin }, '71119000');
        const avisosSur = await vincularTelegram(await crearUsuario(), '71119001', idSur);
        const vendedor = await crearUsuario();
        const tv = await iniciarSesion(vendedor.correo, CLAVE);
        assert.equal((await api('POST', '/caja/turnos/abrir', { token: tv, body: { id_sucursal: 1, monto_inicial: 100 } })).status, 201);

        const [{ id }] = await bd.sql(`SELECT min(id_categoria) AS id FROM categoria_producto`);
        const p = (await api('POST', '/catalogo/productos', { token: tAdmin, body: {
            nombre_producto: 'AVISO TG', precio_unitario: 10, id_categoria: id, id_sucursal: 1, stock_inicial: 10 } })).body.producto.id_producto;

        const cobrar = (cantidad, descuento) => api('POST', '/caja/cobrar', { token: tv,
            body: { id_sucursal: 1, metodo_pago: 'Efectivo', detalles: [{ id_producto: p, cantidad }], descuento } });
        assert.equal((await cobrar(7)).status, 201);                                                   // 10 → 3: stock bajo en sucursal 1
        assert.equal((await cobrar(1, { tipo: 'PORCENTAJE', valor: 10, motivo: 'Prueba' })).status, 201);   // descuento
        assert.equal((await api('POST', '/inventario/transferencias', { token: tv,
            body: { id_sucursal_destino: idSur, items: [{ id_producto: p, cantidad: 2 }] } })).status, 201);  // 2 → 0: agotado + transferencia
        await esperar();

        const textos = (chat) => mensajesA(chat).map(m => m.body.text.split('\n')[0]);
        assert.ok(textos(admin.chat).some(t => t.startsWith('Stock bajo: AVISO TG')));
        assert.ok(textos(admin.chat).some(t => t.startsWith('Descuento manual')));
        assert.ok(textos(admin.chat).some(t => t.startsWith('Agotado: AVISO TG')));
        assert.ok(textos(admin.chat).some(t => t.startsWith('Transferencia')));

        assert.ok(textos(avisosSur.chat).some(t => t.startsWith('Transferencia')));
        assert.ok(!textos(avisosSur.chat).some(t => t.startsWith('Stock bajo') || t.startsWith('Agotado') || t.startsWith('Descuento')));
    });

    test('mensaje de prueba y desvincular', async () => {
        const u = await vincularTelegram(await crearUsuario(), '71110040');
        assert.equal((await api('POST', `/ajustes/telegram/usuarios/${u.id}/prueba`, { token: tAdmin })).status, 200);
        assert.match(mensajesA(u.chat).at(-1).body.text, /Mensaje de prueba/);
        const r = await api('POST', `/ajustes/telegram/usuarios/${u.id}/desvincular`, { token: tAdmin });
        assert.equal(r.body.usuarios.find(x => x.id_usuario === u.id).vinculado, false);
        assert.equal((await api('POST', `/ajustes/telegram/usuarios/${u.id}/prueba`, { token: tAdmin })).status, 400);
    });
});
