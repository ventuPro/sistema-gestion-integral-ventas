const db    = require('../config/db');
const dbAud = require('../config/dbAuditoria');
const ajusteModel = require('./ajusteModel');
const D = require('../auditoria/descripcion');

// ─── Consultas de la pantalla Ajustes → Auditoría ───
// Movimientos: una fila por operación (todas las filas que cambió una petición,
// o una transacción del sistema / hecha directo en la BD).
// Se lee desde lo más reciente por bloques de filas con el índice primario y se
// agrupan solo las operaciones de cada bloque: la primera página cuesta lo mismo
// con un día que con un año de datos. Paginación por cursor (sin OFFSET ni COUNT).
const GRUPO = 'COALESCE(c.id_acceso, -c.id_transaccion)';
const BLOQUE = 2000;
const MAX_VUELTAS = 20;
const MUESTRA_POR_TABLA = 20;
const MAX_DETALLE = 500;
const ES_API = `c.origen ~ '^[A-Z]+ /api/'`;

const EVENTOS = {
    INICIO_SESION:              { texto: 'Inició sesión',                  nivel: 'ok' },
    CIERRE_SESION:              { texto: 'Cerró sesión',                   nivel: 'neutro' },
    INICIO_SESION_FALLIDO:      { texto: 'Intento de ingreso fallido',     nivel: 'mal' },
    CAPTCHA_INCORRECTO:         { texto: 'CAPTCHA incorrecto',             nivel: 'aviso' },
    BLOQUEO_POR_INTENTOS:       { texto: 'Bloqueado por intentos',         nivel: 'mal' },
    CODIGO_TELEGRAM_ENVIADO:    { texto: 'Código enviado por Telegram',    nivel: 'neutro' },
    CODIGO_TELEGRAM_INCORRECTO: { texto: 'Código de Telegram incorrecto',  nivel: 'aviso' },
    TELEGRAM_SIN_RESPUESTA:     { texto: 'Telegram no respondió',          nivel: 'aviso' },
    SESION_INVALIDA:            { texto: 'Sesión vencida o inválida',      nivel: 'aviso' },
    ACCESO_DENEGADO:            { texto: 'Acceso denegado',                nivel: 'mal' },
    ERROR_SERVIDOR:             { texto: 'Error del servidor',             nivel: 'mal' },
    REIMPRESION_COMPROBANTE:    { texto: 'Reimprimió un comprobante',      nivel: 'neutro' },
    IA_CONSULTA:                { texto: 'Consultó al asistente',          nivel: 'neutro' },
    PEDIDO_FALSO:               { texto: 'Marcó un pedido como falso',     nivel: 'aviso' }
};

const TIPOS_ACCESO = [
    { id: 'eventos',  nombre: 'Sesiones y eventos' },
    { id: 'sesiones', nombre: 'Solo sesiones' },
    { id: 'rechazos', nombre: 'Fallidos y rechazados' },
    { id: 'todas',    nombre: 'Todas las peticiones' }
];

const EVENTOS_DE = {
    sesiones: ['INICIO_SESION', 'CIERRE_SESION', 'INICIO_SESION_FALLIDO', 'CAPTCHA_INCORRECTO', 'BLOQUEO_POR_INTENTOS',
               'CODIGO_TELEGRAM_ENVIADO', 'CODIGO_TELEGRAM_INCORRECTO', 'TELEGRAM_SIN_RESPUESTA'],
    rechazos: ['INICIO_SESION_FALLIDO', 'CAPTCHA_INCORRECTO', 'BLOQUEO_POR_INTENTOS', 'CODIGO_TELEGRAM_INCORRECTO',
               'SESION_INVALIDA', 'ACCESO_DENEGADO', 'ERROR_SERVIDOR', 'PEDIDO_FALSO']
};

// ─── Utilidades ───
/** Texto para ILIKE con los comodines escapados */
const patron = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** Filtros de la consulta → condiciones SQL sobre registro_cambio (alias c) */
const condicionesCambio = (f, p) => {
    const w = [];
    const param = (v) => { p.push(v); return `$${p.length}`; };

    if (f.usuario?.startsWith('u:')) w.push(`c.id_usuario = ${param(Number(f.usuario.slice(2)))}`);
    else if (f.usuario === 'sistema')
        w.push(`c.id_usuario IS NULL AND NOT ${ES_API} AND c.usuario <> 'Directo en la BD'`);
    else if (f.usuario === 'cliente') w.push(`c.usuario = 'Cliente (menú QR)'`);
    else if (f.usuario === 'directo') w.push(`c.usuario = 'Directo en la BD'`);

    const modulo = f.modulo && D.filtroModulo(f.modulo);
    if (modulo) w.push(`(c.origen ~ ${param(modulo.regex)} OR (NOT ${ES_API} AND c.tabla = ANY(${param(modulo.tablas)})))`);

    const accion = f.accion && D.filtroAccion(f.accion);
    if (accion) w.push(`(c.origen ~ ${param(accion.regex)} OR (NOT ${ES_API} AND c.operacion = ANY(${param(accion.operaciones)})))`);

    if (f.id_sucursal) {
        const s = param(String(f.id_sucursal));
        w.push(`(COALESCE(c.datos_nuevos, c.datos_anteriores) ->> 'id_sucursal' = ${s}
              OR COALESCE(c.datos_nuevos, c.datos_anteriores) ->> 'id_sucursal_origen' = ${s}
              OR COALESCE(c.datos_nuevos, c.datos_anteriores) ->> 'id_sucursal_destino' = ${s}
              OR c.id_usuario = ANY(${param(f.cajerosSucursal || [])}))`);
    }

    if (f.q) {
        const q = param(patron(f.q));
        w.push(`(c.usuario ILIKE ${q} OR c.ip ILIKE ${q} OR c.origen ILIKE ${q} OR c.id_registro = ${param(f.q)}
              OR c.datos_nuevos::text ILIKE ${q} OR c.datos_anteriores::text ILIKE ${q})`);
    }
    return w;
};

/** Rango de ids que cae entre dos fechas (índice por fecha): las búsquedas recorren solo ese tramo */
const rangoIds = async (tabla, id, desde, hasta) => {
    const r = await dbAud.query(
        `SELECT (SELECT ${id} FROM ${tabla} WHERE fecha_hora >= ($1::date)::timestamp AT TIME ZONE 'America/La_Paz'
                 ORDER BY fecha_hora, ${id} LIMIT 1) AS desde,
                (SELECT ${id} FROM ${tabla} WHERE fecha_hora < ($2::date + 1)::timestamp AT TIME ZONE 'America/La_Paz'
                 ORDER BY fecha_hora DESC, ${id} DESC LIMIT 1) AS hasta`,
        [desde, hasta]);
    const { desde: d, hasta: h } = r.rows[0];
    return d == null || h == null || Number(d) > Number(h) ? null : { desde: Number(d), hasta: Number(h) };
};

/** Cajeros de una sucursal (sus operaciones cuentan para el filtro de sucursal) */
const cajerosDe = async (id_sucursal) =>
    (await db.query(`SELECT id_usuario FROM usuario WHERE id_sucursal = $1 AND id_rol = 2`, [id_sucursal]))
        .rows.map(r => r.id_usuario);

// ─── Nombres para mostrar (una sola consulta a la BD principal por página) ───
const cargarNombres = async (ids) => {
    const r = await db.query(
        `SELECT 'producto' AS t, id_producto AS id, nombre_producto AS n FROM producto WHERE id_producto = ANY($1)
         UNION ALL SELECT 'inventario', i.id_inventario, p.nombre_producto
           FROM inventario_sucursal i JOIN producto p USING (id_producto) WHERE i.id_inventario = ANY($2)
         UNION ALL SELECT 'inventario_sucursal', i.id_inventario, s.nombre_sucursal
           FROM inventario_sucursal i JOIN sucursal s USING (id_sucursal) WHERE i.id_inventario = ANY($2)
         UNION ALL SELECT 'categoria', id_categoria, nombre_categoria FROM categoria_producto WHERE id_categoria = ANY($3)
         UNION ALL SELECT 'mesa', id_mesa, 'Mesa ' || numero_mesa FROM mesa_local WHERE id_mesa = ANY($4)
         UNION ALL SELECT 'mesa_sucursal', id_mesa, id_sucursal::text FROM mesa_local WHERE id_mesa = ANY($4)
         UNION ALL SELECT 'cuenta', cm.id_cuenta, 'Mesa ' || ml.numero_mesa
           FROM cuenta_mesa cm JOIN mesa_local ml USING (id_mesa) WHERE cm.id_cuenta = ANY($5)
         UNION ALL SELECT 'cuenta_sucursal', cm.id_cuenta, ml.id_sucursal::text
           FROM cuenta_mesa cm JOIN mesa_local ml USING (id_mesa) WHERE cm.id_cuenta = ANY($5)
         UNION ALL SELECT 'sucursal', id_sucursal, nombre_sucursal FROM sucursal WHERE id_sucursal = ANY($6)
         UNION ALL SELECT 'usuario', id_usuario, nombre_completo FROM usuario WHERE id_usuario = ANY($7)
         UNION ALL SELECT 'cajero_sucursal', id_usuario, id_sucursal::text FROM usuario WHERE id_usuario = ANY($7) AND id_rol = 2
         UNION ALL SELECT 'rol', id_rol, nombre_rol FROM rol_usuario`,
        [ids.producto, ids.inventario, ids.categoria, ids.mesa, ids.cuenta, ids.sucursal, ids.usuario]);
    const mapa = new Map(r.rows.map(x => [`${x.t}:${x.id}`, x.n]));
    // Sucursales que aparecen solo por mesa/cuenta/cajero
    const faltan = [...new Set(r.rows.filter(x => /_sucursal$/.test(x.t) && x.t !== 'inventario_sucursal')
                                    .map(x => Number(x.n)))].filter(id => !mapa.has(`sucursal:${id}`));
    if (faltan.length) {
        const s = await db.query(`SELECT id_sucursal, nombre_sucursal FROM sucursal WHERE id_sucursal = ANY($1)`, [faltan]);
        for (const x of s.rows) mapa.set(`sucursal:${x.id_sucursal}`, x.nombre_sucursal);
    }
    return { de: (tipo, id) => mapa.get(`${tipo}:${id}`) ?? null };
};

/** Filas crudas de varias operaciones → { grupo: [{ tabla, operacion, n, nuevo, anterior, campos, todas }] } */
const agruparFilas = (filas) => {
    const por = new Map();
    for (const f of filas) {
        const g = String(f.g);
        if (!por.has(g)) por.set(g, new Map());
        const clave = `${f.tabla}|${f.operacion}`;
        const fila = { nuevo: f.datos_nuevos, anterior: f.datos_anteriores, campos: f.campos_modificados };
        const t = por.get(g);
        if (!t.has(clave)) t.set(clave, { tabla: f.tabla, operacion: f.operacion, n: Number(f.n ?? 0), ...fila, todas: [] });
        const x = t.get(clave);
        x.todas.push({ ...fila, operacion: f.operacion });
        if (f.n == null) x.n++;
    }
    return new Map([...por].map(([g, t]) => [g, [...t.values()]]));
};

/** Sucursal de una operación: la de sus datos, la de su mesa/cuenta o la del cajero */
const sucursalDe = (op, filas, nombres) => {
    for (const f of filas) {
        const d = f.nuevo || f.anterior || {};
        const id = d.id_sucursal ?? d.id_sucursal_origen;
        if (id) return nombres.de('sucursal', id);
        if (d.id_mesa && nombres.de('mesa_sucursal', d.id_mesa)) return nombres.de('sucursal', nombres.de('mesa_sucursal', d.id_mesa));
        if (d.id_cuenta && nombres.de('cuenta_sucursal', d.id_cuenta)) return nombres.de('sucursal', nombres.de('cuenta_sucursal', d.id_cuenta));
        if (d.id_inventario && nombres.de('inventario_sucursal', d.id_inventario)) return nombres.de('inventario_sucursal', d.id_inventario);
    }
    const r = D.leerOrigen(op.origen);
    if (r?.ids.length && /^\/cuentas\/:id/.test(r.ruta) && nombres.de('cuenta_sucursal', r.ids[0]))
        return nombres.de('sucursal', nombres.de('cuenta_sucursal', r.ids[0]));
    if (r?.ids.length && /^\/mesas\/:id/.test(r.ruta) && nombres.de('mesa_sucursal', r.ids[0]))
        return nombres.de('sucursal', nombres.de('mesa_sucursal', r.ids[0]));
    const cajero = op.id_usuario && nombres.de('cajero_sucursal', op.id_usuario);
    return cajero ? nombres.de('sucursal', cajero) : null;
};

const presentar = (op, filas, nombres, moneda) => {
    const d = D.describir({ origen: op.origen, filas }, nombres, moneda);
    const u = D.separarUsuario(op.usuario);
    return {
        id: String(op.g),
        fecha: op.fecha,
        usuario: u.nombre,
        correo: u.correo,
        id_usuario: op.id_usuario,
        ip: op.ip,
        sucursal: sucursalDe(op, filas, nombres),
        modulo: d.modulo,
        tipo: d.tipo,
        accion: d.accion,
        detalle: d.detalle,
        filas: Number(op.filas)
    };
};

// ─── Movimientos ───
const movimientos = async (f) => {
    const rango = await rangoIds('registro_cambio', 'id_cambio', f.desde, f.hasta);
    if (!rango) return { movimientos: [], siguiente: null };
    if (f.id_sucursal) f.cajerosSucursal = await cajerosDe(f.id_sucursal);

    const limite = f.por_pagina;
    let cursor = f.antes ? Math.min(f.antes, rango.hasta + 1) : rango.hasta + 1;
    const encontrados = [];
    let siguiente = null;

    for (let vuelta = 0; ; vuelta++) {
        const p = [rango.desde, cursor, BLOQUE];
        const w = condicionesCambio(f, p);
        const r = await dbAud.query(
            `WITH escaneo AS (
                 SELECT c.id_cambio, ${GRUPO} AS g FROM registro_cambio c
                 WHERE c.id_cambio >= $1 AND c.id_cambio < $2 ${w.map(x => `AND ${x}`).join(' ')}
                 ORDER BY c.id_cambio DESC LIMIT $3
             ), grupos AS (
                 SELECT ${GRUPO} AS g, max(c.id_cambio) AS ultimo, min(c.fecha_hora) AS fecha, count(*) AS filas,
                        max(c.usuario) AS usuario, max(c.id_usuario) AS id_usuario, max(c.ip) AS ip, max(c.origen) AS origen
                 FROM registro_cambio c
                 WHERE ${GRUPO} = ANY(ARRAY(SELECT DISTINCT g FROM escaneo))
                 GROUP BY 1
                 HAVING max(c.id_cambio) < $2
             )
             SELECT (SELECT min(id_cambio) FROM escaneo) AS minimo,
                    (SELECT count(*) FROM escaneo)::int AS leidas,
                    COALESCE((SELECT json_agg(grupos ORDER BY ultimo DESC) FROM grupos), '[]') AS grupos`, p);
        const { minimo, leidas, grupos } = r.rows[0];
        encontrados.push(...grupos);

        if (encontrados.length >= limite) {
            encontrados.length = limite;
            siguiente = Number(encontrados.at(-1).ultimo);
            break;
        }
        if (leidas < BLOQUE) break;                 // no queda nada en el rango
        cursor = Number(minimo);
        if (vuelta + 1 >= MAX_VUELTAS) { siguiente = cursor; break; }   // la pantalla pide seguir
    }

    if (!encontrados.length) return { movimientos: [], siguiente };

    const ids = encontrados.map(g => g.g);
    const filas = (await dbAud.query(
        `SELECT g, tabla, operacion, n, campos_modificados, datos_anteriores, datos_nuevos FROM (
             SELECT ${GRUPO} AS g, c.tabla, c.operacion, c.campos_modificados, c.datos_anteriores, c.datos_nuevos,
                    row_number() OVER (PARTITION BY ${GRUPO}, c.tabla, c.operacion ORDER BY c.id_cambio) AS rn,
                    count(*)     OVER (PARTITION BY ${GRUPO}, c.tabla, c.operacion) AS n
             FROM registro_cambio c WHERE ${GRUPO} = ANY($1::bigint[])
         ) x WHERE rn <= $2`, [ids, MUESTRA_POR_TABLA])).rows;

    const porGrupo = agruparFilas(filas);
    const referidos = D.idsReferidos(filas, encontrados.map(g => g.origen));
    for (const g of encontrados) if (g.id_usuario) referidos.usuario.push(g.id_usuario);
    const [nombres, { moneda_simbolo }] = await Promise.all([cargarNombres(referidos), ajusteModel.parametros()]);

    return {
        movimientos: encontrados.map(g => presentar(g, porGrupo.get(String(g.g)) || [], nombres, moneda_simbolo)),
        siguiente
    };
};

/** Detalle de una operación: cada fila con sus campos antes / después */
const movimiento = async (id) => {
    const filas = (await dbAud.query(
        `SELECT ${GRUPO} AS g, c.id_cambio, c.fecha_hora, c.tabla, c.operacion, c.id_registro, c.campos_modificados,
                c.datos_anteriores, c.datos_nuevos, c.usuario, c.id_usuario, c.ip, c.origen, c.usuario_bd
         FROM registro_cambio c WHERE ${GRUPO} = $1 ORDER BY c.id_cambio LIMIT $2`, [id, MAX_DETALLE + 1])).rows;
    if (!filas.length) return null;

    const truncado = filas.length > MAX_DETALLE;
    if (truncado) filas.length = MAX_DETALLE;

    const [total, acceso] = await Promise.all([
        truncado ? dbAud.query(`SELECT count(*)::int AS n FROM registro_cambio c WHERE ${GRUPO} = $1`, [id]).then(r => r.rows[0].n)
                 : filas.length,
        id > 0 ? dbAud.query(
            `SELECT metodo, ruta, agente_usuario, estado_http, duracion_ms, evento FROM registro_acceso WHERE id_acceso = $1`, [id])
            .then(r => r.rows[0] || null) : null
    ]);

    const primera = filas[0];
    const op = { g: id, fecha: primera.fecha_hora, usuario: primera.usuario, id_usuario: primera.id_usuario,
                 ip: primera.ip, origen: primera.origen, filas: total };
    const referidos = D.idsReferidos(filas, [primera.origen]);
    if (op.id_usuario) referidos.usuario.push(op.id_usuario);
    const [nombres, { moneda_simbolo }] = await Promise.all([cargarNombres(referidos), ajusteModel.parametros()]);
    const agrupadas = agruparFilas(filas.map(f => ({ ...f, n: null }))).get(String(id)) || [];

    const OPERACION = { INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó', TRUNCATE: 'Vació' };
    return {
        ...presentar(op, agrupadas, nombres, moneda_simbolo),
        origen: primera.origen,
        usuario_bd: primera.usuario_bd,
        navegador: D.navegador(acceso?.agente_usuario),
        agente: acceso?.agente_usuario || null,
        estado_http: acceso?.estado_http ?? null,
        duracion_ms: acceso?.duracion_ms ?? null,
        truncado,
        cambios: filas.map(f => ({
            id: Number(f.id_cambio),
            tabla: D.nombreTabla(f.tabla),
            operacion: OPERACION[f.operacion],
            tipo: f.operacion,
            registro: f.id_registro,
            campos: D.camposDeFila(f, nombres)
        }))
    };
};

// ─── Accesos ───
const detalleAcceso = (d) => {
    if (!d || typeof d !== 'object') return null;
    const sinNombres = { de: () => null };
    const partes = Object.entries(d)
        .filter(([k, v]) => !['sesion', 'contada_en'].includes(k) && v != null && v !== '' && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')}: ${D.valorTexto(k, v, sinNombres)}`);
    const t = partes.join(' · ');
    return t ? (t.length > 240 ? t.slice(0, 240) + '…' : t) : null;
};

const accesos = async (f) => {
    const rango = await rangoIds('registro_acceso', 'id_acceso', f.desde, f.hasta);
    if (!rango) return { accesos: [], siguiente: null };

    const p = [rango.desde, f.antes ? Math.min(f.antes, rango.hasta + 1) : rango.hasta + 1, f.por_pagina + 1];
    const param = (v) => { p.push(v); return `$${p.length}`; };
    const w = [];
    if (f.tipo === 'sesiones' || f.tipo === 'rechazos') w.push(`a.evento = ANY(${param(EVENTOS_DE[f.tipo])})`);
    else if (f.tipo !== 'todas') w.push(`a.evento <> 'PETICION'`);
    if (f.usuario?.startsWith('u:')) w.push(`a.id_usuario = ${param(Number(f.usuario.slice(2)))}`);
    else if (f.usuario === 'cliente') w.push(`a.ruta LIKE '/api/menu/%'`);
    else if (f.usuario === 'sistema' || f.usuario === 'directo') w.push('FALSE');
    if (f.q) {
        const q = param(patron(f.q));
        w.push(`(a.usuario ILIKE ${q} OR a.ip ILIKE ${q} OR a.ruta ILIKE ${q} OR a.detalle::text ILIKE ${q})`);
    }

    const r = await dbAud.query(
        `SELECT a.id_acceso, a.fecha_hora, a.fecha_hora_ultima, a.evento, a.id_usuario, a.usuario, a.ip, a.agente_usuario,
                a.metodo, a.ruta, a.estado_http, a.repeticiones, a.detalle
         FROM registro_acceso a
         WHERE a.id_acceso >= $1 AND a.id_acceso < $2 ${w.map(x => `AND ${x}`).join(' ')}
         ORDER BY a.id_acceso DESC LIMIT $3`, p);

    const hayMas = r.rows.length > f.por_pagina;
    const filas = hayMas ? r.rows.slice(0, f.por_pagina) : r.rows;
    return {
        accesos: filas.map(a => {
            const ev = EVENTOS[a.evento];
            const u = D.separarUsuario(a.usuario);
            const consulta = a.evento === 'PETICION';
            return {
                id: Number(a.id_acceso),
                fecha: a.fecha_hora,
                hasta: a.repeticiones > 1 ? a.fecha_hora_ultima : null,
                veces: a.repeticiones,
                evento: a.evento,
                texto: ev?.texto || (consulta ? (a.metodo === 'GET' ? 'Consulta' : 'Operación') : a.evento),
                nivel: ev?.nivel || (a.estado_http >= 400 ? 'aviso' : 'neutro'),
                usuario: a.usuario ? u.nombre : (a.detalle?.correo || (a.ruta?.startsWith('/api/menu') ? 'Cliente (menú QR)' : '—')),
                correo: u.correo || a.detalle?.correo || null,
                ip: a.ip,
                navegador: D.navegador(a.agente_usuario),
                ruta: `${a.metodo} ${a.ruta}`,
                estado_http: a.estado_http,
                detalle: detalleAcceso(a.detalle)
            };
        }),
        siguiente: hayMas ? Number(filas.at(-1).id_acceso) : null
    };
};

// ─── Opciones de los filtros (una sola petición al abrir la pantalla) ───
const opciones = async () => {
    const [u, s] = await Promise.all([
        db.query(`SELECT u.id_usuario, u.nombre_completo, r.nombre_rol, u.estado_activo
                  FROM usuario u LEFT JOIN rol_usuario r USING (id_rol)
                  ORDER BY u.estado_activo DESC, u.nombre_completo`),
        db.query(`SELECT id_sucursal, nombre_sucursal FROM sucursal ORDER BY nombre_sucursal`)
    ]);
    return {
        usuarios: u.rows,
        sucursales: s.rows,
        modulos: D.MODULOS.map(m => ({ id: m.id, nombre: m.nombre })),
        tipos_acceso: TIPOS_ACCESO
    };
};

module.exports = { movimientos, movimiento, accesos, opciones, TIPOS_ACCESO };
