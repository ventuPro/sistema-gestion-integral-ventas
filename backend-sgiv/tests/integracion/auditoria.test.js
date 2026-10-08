const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { crearBdPrueba } = require('../bdPrueba');
const { crearLogin, resolverCaptcha } = require('../sesionPrueba');

// ─── Pruebas de la auditoría (BD separada + triggers) ───
let bd, servidor, io, pool, URL_BASE;
const CLAVE = 'Prueba123';

const api = async (metodo, ruta, { token, body } = {}) => {
    const r = await fetch(`${URL_BASE}/api${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    return { status: r.status, body: datos };
};

const iniciarSesion = crearLogin((...a) => api(...a));
const login = (correo, contrasena = CLAVE) => iniciarSesion(correo, contrasena);

const crearUsuario = async (correo, id_rol) => {
    const hash = await bcrypt.hash(CLAVE, 4);
    const [u] = await bd.sql(
        `INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash)
         VALUES (1, $1, $2, $2, $3) RETURNING id_usuario`, [id_rol, correo, hash]);
    return u.id_usuario;
};

/** El resultado de la petición se completa al terminar la respuesta: se espera un momento. */
const ultimoAcceso = async (metodo, ruta) => {
    for (let i = 0; i < 40; i++) {
        const [a] = await bd.sqlAuditoria(
            `SELECT * FROM registro_acceso WHERE metodo = $1 AND ruta = $2 ORDER BY id_acceso DESC LIMIT 1`,
            [metodo, `/api${ruta}`]);
        if (a?.estado_http) return a;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Sin registro completo de ${metodo} ${ruta}`);
};

const cambios = (tabla, id_registro) => bd.sqlAuditoria(
    `SELECT * FROM registro_cambio WHERE tabla = $1 AND id_registro = $2 ORDER BY id_cambio`,
    [tabla, String(id_registro)]);

before(async () => {
    bd = await crearBdPrueba();
    ({ server: servidor, io } = require('../../src/server'));
    pool = require('../../src/config/db');
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    URL_BASE = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
    if (io)   await new Promise(r => io.close(() => r()));
    if (pool) await pool.end();
    await require('../../src/config/dbAuditoria').end();
    if (bd)   await bd.eliminar();
});

// ─── Sesiones ───
describe('Auditoría de sesiones', () => {
    test('registra inicio de sesión, intento fallido, CAPTCHA incorrecto y cierre', async () => {
        const id = await crearUsuario('sesion@prueba.com', 2);

        const { id_captcha } = resolverCaptcha();
        await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'sesion@prueba.com', contrasena: CLAVE, id_captcha, captcha: 'zzzzz' } });
        assert.equal((await ultimoAcceso('POST', '/usuarios/login')).evento, 'CAPTCHA_INCORRECTO');

        await api('POST', '/usuarios/login',
            { body: { correo_electronico: 'sesion@prueba.com', contrasena: 'mala', ...resolverCaptcha() } });
        const fallido = await ultimoAcceso('POST', '/usuarios/login');
        assert.equal(fallido.evento, 'INICIO_SESION_FALLIDO');
        assert.equal(fallido.estado_http, 401);
        assert.deepEqual(fallido.detalle, { correo: 'sesion@prueba.com', motivo: 'Contraseña incorrecta' });

        const token = await login('sesion@prueba.com');
        const ok = await ultimoAcceso('POST', '/usuarios/login');
        assert.equal(ok.evento, 'INICIO_SESION');
        assert.equal(ok.id_usuario, id);
        assert.equal(ok.usuario, 'sesion@prueba.com <sesion@prueba.com>');
        assert.equal(ok.ip, '127.0.0.1');

        assert.equal((await api('POST', '/usuarios/logout', { token })).status, 200);
        const cierre = await ultimoAcceso('POST', '/usuarios/logout');
        assert.equal(cierre.evento, 'CIERRE_SESION');
        assert.equal(cierre.id_usuario, id);
    });

    test('la contraseña enviada al iniciar sesión nunca se guarda', async () => {
        const filas = await bd.sqlAuditoria(`SELECT count(*)::int AS n FROM registro_acceso WHERE detalle::text LIKE '%${CLAVE}%'`);
        assert.equal(filas[0].n, 0);
    });
});

// ─── Consultas ───
describe('Auditoría de consultas', () => {
    test('registra consultas, accesos denegados y sesiones inválidas', async () => {
        await crearUsuario('consulta@prueba.com', 2);
        const tCajero = await login('consulta@prueba.com');
        const tAdmin  = await login('admin@rickys.com', 'password');

        await api('GET', '/usuarios', { token: tAdmin });
        const consulta = await ultimoAcceso('GET', '/usuarios');
        assert.equal(consulta.evento, 'PETICION');
        assert.equal(consulta.estado_http, 200);
        assert.ok(consulta.duracion_ms >= 0);

        await api('GET', '/usuarios', { token: tCajero });
        const denegado = await ultimoAcceso('GET', '/usuarios');
        assert.equal(denegado.evento, 'ACCESO_DENEGADO');
        assert.equal(denegado.usuario, 'consulta@prueba.com <consulta@prueba.com>');

        await api('GET', '/usuarios');
        assert.equal((await ultimoAcceso('GET', '/usuarios')).evento, 'SESION_INVALIDA');
    });
});

// ─── Cambios (triggers) ───
describe('Auditoría de cambios con triggers', () => {
    test('un cambio por la API registra quién, antes, después y la petición que lo hizo', async () => {
        const id = await crearUsuario('editar@prueba.com', 2);
        const tAdmin = await login('admin@rickys.com', 'password');
        const r = await api('PUT', `/usuarios/${id}`, { token: tAdmin, body: {
            nombre_completo: 'Nombre Editado', correo_electronico: 'editar@prueba.com', id_rol: 2, id_sucursal: 1 } });
        assert.equal(r.status, 200);

        const acceso = await ultimoAcceso('PUT', `/usuarios/${id}`);
        const [insert, update] = await cambios('usuario', id);
        assert.equal(insert.operacion, 'INSERT');
        assert.equal(insert.usuario, 'Directo en la BD');

        assert.equal(update.operacion, 'UPDATE');
        assert.deepEqual(update.campos_modificados, ['nombre_completo']);
        assert.equal(update.datos_anteriores.nombre_completo, 'editar@prueba.com');
        assert.equal(update.datos_nuevos.nombre_completo, 'Nombre Editado');
        assert.match(update.usuario, /<admin@rickys\.com>$/);
        assert.equal(update.origen, `PUT /api/usuarios/${id}`);
        assert.equal(update.ip, '127.0.0.1');
        assert.equal(update.id_acceso, acceso.id_acceso);
    });

    test('la contraseña queda como [oculto]', async () => {
        const id = await crearUsuario('clave@prueba.com', 2);
        const tAdmin = await login('admin@rickys.com', 'password');
        await api('PATCH', `/usuarios/${id}/contrasena`, { token: tAdmin, body: { nueva_contrasena: 'OtraClave1' } });

        const todos = await cambios('usuario', id);
        const update = todos.at(-1);
        assert.deepEqual(update.campos_modificados, ['contrasena_hash']);
        assert.equal(update.datos_anteriores.contrasena_hash, '[oculto]');
        assert.equal(update.datos_nuevos.contrasena_hash, '[oculto]');
        assert.ok(todos.every(c => !JSON.stringify(c).includes('$2')));
    });

    test('un UPDATE sin cambios reales no se registra; DELETE guarda los datos borrados', async () => {
        const [c] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Auditada') RETURNING id_categoria`);
        await bd.sql(`UPDATE categoria_producto SET nombre_categoria = 'Auditada' WHERE id_categoria = $1`, [c.id_categoria]);
        await bd.sql(`DELETE FROM categoria_producto WHERE id_categoria = $1`, [c.id_categoria]);

        const filas = await cambios('categoria_producto', c.id_categoria);
        assert.deepEqual(filas.map(f => f.operacion), ['INSERT', 'DELETE']);
        assert.equal(filas[1].datos_anteriores.nombre_categoria, 'Auditada');
        assert.equal(filas[1].datos_nuevos, null);
        assert.match(filas[1].origen, /^Directo en la BD/);
    });

    test('las tablas nuevas quedan auditadas, incluido TRUNCATE', async () => {
        await bd.sql(`CREATE TABLE tabla_nueva (id SERIAL PRIMARY KEY, dato TEXT)`);
        await bd.sql(`SELECT auditoria.activar_en_todas()`);
        await bd.sql(`INSERT INTO tabla_nueva (dato) VALUES ('x')`);
        await bd.sql(`TRUNCATE tabla_nueva`);

        const filas = await bd.sqlAuditoria(
            `SELECT operacion FROM registro_cambio WHERE tabla = 'tabla_nueva' ORDER BY id_cambio`);
        assert.deepEqual(filas.map(f => f.operacion), ['INSERT', 'TRUNCATE']);
    });
});

// ─── Seguridad de la auditoría ───
describe('Integridad de la auditoría', () => {
    test('los registros no se pueden modificar ni borrar', async () => {
        await assert.rejects(bd.sqlAuditoria(`UPDATE registro_cambio SET usuario = 'otro'`), /no se puede modificar/);
        await assert.rejects(bd.sqlAuditoria(`DELETE FROM registro_cambio`), /no se puede modificar/);
        await assert.rejects(bd.sqlAuditoria(`TRUNCATE registro_cambio CASCADE`), /no se puede modificar/);
        await assert.rejects(bd.sqlAuditoria(`DELETE FROM registro_acceso`), /no se puede modificar/);
        await assert.rejects(
            bd.sqlAuditoria(`UPDATE registro_acceso SET estado_http = 200 WHERE estado_http IS NOT NULL`),
            /no se puede modificar/);
    });

    test('si la BD de auditoría no responde, el cambio no se guarda', async () => {
        const [c] = await bd.sql(`INSERT INTO categoria_producto (nombre_categoria) VALUES ('Intacta') RETURNING id_categoria`);
        const [{ dbname }] = await bd.sql(
            `SELECT option_value AS dbname FROM pg_options_to_table((SELECT srvoptions FROM pg_foreign_server WHERE srvname = 'sgiv_auditoria_srv')) WHERE option_name = 'dbname'`);
        await bd.sql(`ALTER SERVER sgiv_auditoria_srv OPTIONS (SET dbname 'bd_que_no_existe')`);
        try {
            await assert.rejects(
                bd.sql(`UPDATE categoria_producto SET nombre_categoria = 'Cambiada' WHERE id_categoria = $1`, [c.id_categoria]));
        } finally {
            await bd.sql(`ALTER SERVER sgiv_auditoria_srv OPTIONS (SET dbname '${dbname}')`);
        }
        const [actual] = await bd.sql(`SELECT nombre_categoria FROM categoria_producto WHERE id_categoria = $1`, [c.id_categoria]);
        assert.equal(actual.nombre_categoria, 'Intacta');
    });

    test('si no se puede registrar la petición, la API responde 503', async () => {
        await bd.sqlAuditoria(`ALTER TABLE registro_acceso ADD CONSTRAINT prueba_bloqueo CHECK (false) NOT VALID`);
        try {
            assert.equal((await api('GET', '/usuarios/captcha')).status, 503);
        } finally {
            await bd.sqlAuditoria(`ALTER TABLE registro_acceso DROP CONSTRAINT prueba_bloqueo`);
        }
        assert.equal((await api('GET', '/usuarios/captcha')).status, 200);
    });
});
