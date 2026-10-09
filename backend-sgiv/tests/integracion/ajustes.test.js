const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin }    = require('../sesionPrueba');

// ─── Módulo Ajustes: configuración del negocio ───

let bd, servidor, io, pool, URL_BASE, tokenAdmin, tokenCajero;

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, body: await r.json() };
};

const login = crearLogin((...a) => api(...a));

// PNG de 1x1 píxel
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

before(async () => {
    bd = await crearBdPrueba();
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;

    const hash = await bcrypt.hash('Prueba123', 4);
    await bd.sql(`INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
                  VALUES (1, 2, 'Cajero Ajustes', 'cajero.ajustes@prueba.com', $1)`, [hash]);
    tokenAdmin  = await login('admin@rickys.com', 'password');
    tokenCajero = await login('cajero.ajustes@prueba.com', 'Prueba123');
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    if (bd)   await bd.eliminar();
});

test('sin cambios, los ajustes tienen los valores originales del sistema', async () => {
    const r = await api('GET', '/ajustes/publico');
    assert.equal(r.status, 200);
    assert.equal(r.body.nombre_comercial, "Pastelería Ricky's");
    assert.equal(r.body.color_primario, null);
    assert.equal(r.body.tema, 'claro');
    assert.equal(r.body.id_configuracion, undefined);
});

test('solo el administrador puede ver y modificar los ajustes', async () => {
    assert.equal((await api('GET', '/ajustes')).status, 401);
    assert.equal((await api('GET', '/ajustes', { token: tokenCajero })).status, 403);
    const r = await api('PUT', '/ajustes/empresa', { token: tokenCajero, body: { nombre_comercial: 'Hackeado' } });
    assert.equal(r.status, 403);
    assert.equal((await api('GET', '/ajustes', { token: tokenAdmin })).status, 200);
});

test('el administrador guarda los datos de la empresa (vacío = NULL)', async () => {
    const r = await api('PUT', '/ajustes/empresa', {
        token: tokenAdmin,
        body: { nombre_comercial: '  Café Andino ', nit: '1234567-1A', correo: 'hola@andino.bo', eslogan: '' }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.configuracion.nombre_comercial, 'Café Andino');
    assert.equal(r.body.configuracion.nit, '1234567-1A');
    assert.equal(r.body.configuracion.eslogan, null);
    assert.equal(r.body.configuracion.ciudad, 'La Paz');   // lo no enviado no cambia
});

test('datos de empresa inválidos se rechazan sin guardar nada', async () => {
    const casos = [
        { nombre_comercial: '   ' },
        { correo: 'no-es-correo' },
        { nit: '123 456' },
        { sitio_web: 'javascript:alert(1)' },
        { telefono: 'abc' },
        { eslogan: 'x'.repeat(151) }
    ];
    for (const body of casos) {
        const r = await api('PUT', '/ajustes/empresa', { token: tokenAdmin, body });
        assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await api('GET', '/ajustes/publico')).body.nombre_comercial, 'Café Andino');
});

test('apariencia: colores, tema y logo; NULL restaura lo original', async () => {
    const r = await api('PUT', '/ajustes/apariencia', {
        token: tokenAdmin,
        body: { color_primario: '#B45309', color_secundario: '#7c3aed', tema: 'oscuro', logo: PNG }
    });
    assert.equal(r.status, 200);
    const c = r.body.configuracion;
    assert.equal(c.color_primario, '#b45309');
    assert.equal(c.tema, 'oscuro');
    assert.match(c.url_logo, /^\/uploads\/empresa\/logo_\d+\.png$/);
    const archivo = path.join(__dirname, '..', '..', c.url_logo);
    assert.ok(fs.existsSync(archivo));
    fs.unlinkSync(archivo);

    const r2 = await api('PUT', '/ajustes/apariencia', {
        token: tokenAdmin, body: { color_primario: null, color_secundario: null, tema: 'claro', logo: null }
    });
    assert.equal(r2.body.configuracion.color_primario, null);
    assert.equal(r2.body.configuracion.url_logo, null);
});

test('apariencia inválida se rechaza (color, tema, SVG, imagen grande)', async () => {
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64');
    const grande = 'data:image/png;base64,' + Buffer.alloc(600 * 1024).toString('base64');
    const casos = [
        { color_primario: 'red' },
        { color_primario: '#12345' },
        { tema: 'rosado' },
        { logo: svg },
        { favicon: grande }
    ];
    for (const body of casos) {
        const r = await api('PUT', '/ajustes/apariencia', { token: tokenAdmin, body });
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
});

test('los cambios de ajustes quedan en la auditoría', async () => {
    const filas = await bd.sqlAuditoria(
        `SELECT usuario, campos_modificados FROM registro_cambio
         WHERE tabla = 'configuracion' AND operacion = 'UPDATE' ORDER BY id_cambio`);
    assert.ok(filas.length >= 2);
    assert.match(filas[0].usuario, /admin@rickys\.com/);
    assert.ok(filas[0].campos_modificados.includes('nombre_comercial'));
});

// ─── Propietarios ───
test('propietarios: solo el administrador y la suma no pasa del 100 %', async () => {
    assert.equal((await api('GET', '/ajustes/propietarios', { token: tokenCajero })).status, 403);

    const a = await api('POST', '/ajustes/propietarios', {
        token: tokenAdmin, body: { nombre_completo: 'Ricardo Pérez', ci: '1234567 lp', porcentaje_participacion: 60 } });
    assert.equal(a.status, 201);
    assert.equal(a.body.propietario.ci, '1234567 LP');

    const b = await api('POST', '/ajustes/propietarios', {
        token: tokenAdmin, body: { nombre_completo: 'Ana Pérez', porcentaje_participacion: 50 } });
    assert.equal(b.status, 400);
    assert.match(b.body.error, /Disponible: 40\.00/);

    const c = await api('POST', '/ajustes/propietarios', {
        token: tokenAdmin, body: { nombre_completo: 'Ana Pérez', porcentaje_participacion: 40 } });
    assert.equal(c.status, 201);

    // Al editar, su propio porcentaje no cuenta como ocupado
    const id = a.body.propietario.id_propietario;
    const ed = await api('PUT', `/ajustes/propietarios/${id}`, {
        token: tokenAdmin, body: { nombre_completo: 'Ricardo Pérez', ci: '1234567 LP', porcentaje_participacion: 60 } });
    assert.equal(ed.status, 200);

    const lista = await api('GET', '/ajustes/propietarios', { token: tokenAdmin });
    assert.equal(lista.body.length, 2);
    assert.equal((await api('DELETE', `/ajustes/propietarios/${id}`, { token: tokenAdmin })).status, 200);
    assert.equal((await api('DELETE', `/ajustes/propietarios/${id}`, { token: tokenAdmin })).status, 404);
});

test('propietarios: datos inválidos o CI repetido se rechazan', async () => {
    const casos = [
        { nombre_completo: '' },
        { nombre_completo: 'X', ci: 'ABC' },
        { nombre_completo: 'X', correo: 'malo' },
        { nombre_completo: 'X', porcentaje_participacion: -5 },
        { nombre_completo: 'X', porcentaje_participacion: 'mucho' }
    ];
    for (const body of casos)
        assert.equal((await api('POST', '/ajustes/propietarios', { token: tokenAdmin, body })).status, 400, JSON.stringify(body));

    await api('POST', '/ajustes/propietarios', { token: tokenAdmin, body: { nombre_completo: 'Uno', ci: '7654321' } });
    const rep = await api('POST', '/ajustes/propietarios', { token: tokenAdmin, body: { nombre_completo: 'Dos', ci: '7654321' } });
    assert.equal(rep.status, 409);
});

// ─── Sucursales ───
const HORARIO = [
    { dia_semana: 1, abierto: true, hora_apertura: '08:00', hora_cierre: '20:00' },
    { dia_semana: 7, abierto: false }
];

test('sucursales: crear con horario, nombre único y solo administrador', async () => {
    const r = await api('POST', '/sucursales', {
        token: tokenAdmin, body: { nombre_sucursal: 'Sucursal Norte', telefono_contacto: '2 2123456', horario: HORARIO } });
    assert.equal(r.status, 201);

    const lista = (await api('GET', '/sucursales', { token: tokenCajero })).body;
    const norte = lista.find(s => s.nombre_sucursal === 'Sucursal Norte');
    assert.equal(norte.estado_activo, true);
    assert.deepEqual(norte.horario.map(h => [h.dia_semana, h.abierto, h.hora_apertura]), [[1, true, '08:00'], [7, false, null]]);

    assert.equal((await api('POST', '/sucursales', { token: tokenAdmin, body: { nombre_sucursal: ' sucursal norte ' } })).status, 409);
    assert.equal((await api('POST', '/sucursales', { token: tokenCajero, body: { nombre_sucursal: 'Otra' } })).status, 403);
    const malo = await api('POST', '/sucursales', {
        token: tokenAdmin, body: { nombre_sucursal: 'Sur', horario: [{ dia_semana: 2, abierto: true, hora_apertura: '25:00', hora_cierre: '10:00' }] } });
    assert.equal(malo.status, 400);
});

test('sucursales: editar y desactivar con reglas de seguridad', async () => {
    const lista = (await api('GET', '/sucursales', { token: tokenAdmin })).body;
    const norte = lista.find(s => s.nombre_sucursal === 'Sucursal Norte');

    const ed = await api('PUT', `/sucursales/${norte.id_sucursal}`, {
        token: tokenAdmin,
        body: { nombre_sucursal: 'Sucursal Norte', direccion_fisica: 'Av. Busch',
                horario: [{ dia_semana: 1, abierto: true, hora_apertura: '09:00', hora_cierre: '21:00' }] } });
    assert.equal(ed.status, 200);
    const horario = (await api('GET', '/sucursales', { token: tokenAdmin })).body
        .find(s => s.id_sucursal === norte.id_sucursal).horario;
    assert.equal(horario.find(h => h.dia_semana === 1).hora_apertura, '09:00');
    assert.equal(horario.length, 2);   // el domingo se mantiene

    // La sucursal 1 tiene usuarios activos: no se puede desactivar
    const s1 = await api('PATCH', '/sucursales/1/estado', { token: tokenAdmin, body: { estado_activo: false } });
    assert.equal(s1.status, 409);
    assert.match(s1.body.error, /usuario/);

    const des = await api('PATCH', `/sucursales/${norte.id_sucursal}/estado`, { token: tokenAdmin, body: { estado_activo: false } });
    assert.equal(des.status, 200);

    // Inactiva: no se ofrece al crear usuarios y no se puede abrir caja en ella
    const form = await api('GET', '/usuarios/form-data', { token: tokenAdmin });
    assert.ok(!form.body.sucursales.some(s => s.id_sucursal === norte.id_sucursal));
    const caja = await api('POST', '/caja/turnos/abrir', { token: tokenAdmin, body: { id_sucursal: norte.id_sucursal, monto_inicial: 0 } });
    assert.equal(caja.status, 400);

    assert.equal((await api('PATCH', `/sucursales/${norte.id_sucursal}/estado`, { token: tokenAdmin, body: { estado_activo: true } })).status, 200);
    assert.equal((await api('PUT', '/sucursales/abc', { token: tokenAdmin, body: { nombre_sucursal: 'X' } })).status, 404);
});

test('parámetros: valores originales, validación y método de pago', async () => {
    const pub = (await api('GET', '/ajustes/publico')).body;
    assert.equal(pub.moneda_simbolo, 'Bs.');
    assert.equal(pub.ticket_mensaje_pie, '¡Gracias por su compra!');
    assert.equal(pub.login_max_intentos, undefined);   // los de seguridad no son públicos

    assert.equal((await api('PUT', '/ajustes/parametros', { token: tokenCajero, body: { pago_qr: false } })).status, 403);
    for (const body of [{ sesion_horas: 0 }, { login_max_intentos: 2.5 }, { menu_activo: 'si' },
                        { moneda_simbolo: '' }, { pago_efectivo: false, pago_qr: false }]) {
        const r = await api('PUT', '/ajustes/parametros', { token: tokenAdmin, body });
        assert.equal(r.status, 400, JSON.stringify(body));
    }

    const r = await api('PUT', '/ajustes/parametros', { token: tokenAdmin,
        body: { pago_qr: false, moneda_simbolo: ' $ ', stock_minimo_defecto: 8, qr_cobro: PNG } });
    assert.equal(r.status, 200);
    assert.equal(r.body.configuracion.moneda_simbolo, '$');
    assert.match(r.body.configuracion.url_qr_cobro, /^\/uploads\/empresa\/qr-cobro_\d+\.png$/);
    fs.unlinkSync(path.join(__dirname, '..', '..', r.body.configuracion.url_qr_cobro));

    // QR deshabilitado: el cobro por QR se rechaza
    const v = await api('POST', '/caja/cobrar', { token: tokenAdmin, body: { id_sucursal: 1, metodo_pago: 'QR', detalles: [] } });
    assert.equal(v.status, 400);
    assert.match(v.body.detalle, /QR/);
    assert.equal((await api('PUT', '/ajustes/parametros', { token: tokenAdmin, body: { pago_efectivo: false } })).status, 400);

    const vuelta = await api('PUT', '/ajustes/parametros', { token: tokenAdmin,
        body: { pago_qr: true, moneda_simbolo: 'Bs.', stock_minimo_defecto: 5, qr_cobro: null } });
    assert.equal(vuelta.body.configuracion.url_qr_cobro, null);
});

test('parámetros: sin CAPTCHA y con duración de sesión configurada', async () => {
    await api('PUT', '/ajustes/parametros', { token: tokenAdmin, body: { captcha_activo: false, sesion_horas: 2 } });
    const r = await api('POST', '/usuarios/login', { body: { correo_electronico: 'admin@rickys.com', contrasena: 'password' } });
    assert.equal(r.status, 200);
    const { exp, iat } = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url').toString());
    assert.equal(exp - iat, 2 * 3600);

    await api('PUT', '/ajustes/parametros', { token: tokenAdmin, body: { captcha_activo: true, sesion_horas: 8 } });
    const sin = await api('POST', '/usuarios/login', { body: { correo_electronico: 'admin@rickys.com', contrasena: 'password' } });
    assert.equal(sin.status, 400);
});
