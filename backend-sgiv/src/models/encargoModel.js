const db = require('../config/db');
const notificacionModel = require('./notificacionModel');
const { revisar, numero, ErrorValidacion } = require('../utils/validacion');
const { mayusculas } = require('../utils/texto');

// ─── Encargos para eventos ───
// Pedidos programados (tortas, bocaditos...). No tocan la caja ni el stock: el adelanto
// es solo informativo y al entregarse se da por cobrado el saldo.
// Estados: Recibido → Entregado (se puede deshacer). Solo se edita o elimina lo Recibido.

const TIPOS_EVENTO = ['CUMPLEAÑOS', 'BODA', 'QUINCE AÑOS', 'BAUTIZO', 'GRADUACIÓN', 'EMPRESA', 'OTRO'];
const MAX_LINEAS = 50;
const MAX_MONTO = 1_000_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
// Los avisos salen desde esta hora (no a medianoche)
const HORA_AVISO_DEL_DIA = '06:00';

const error = (codigo, message) => Object.assign(new Error(message), { codigo });

// Último aviso que ya no hace falta mandar para esa fecha de entrega (0 ninguno, 1 anticipado, 2 el día)
const NIVEL_AVISO = (fecha = 'e.fecha_entrega') => `(CASE
    WHEN ${fecha}::date <= CURRENT_DATE THEN 2
    WHEN ${fecha}::date - CURRENT_DATE <= (SELECT aviso_encargo_dias FROM configuracion WHERE id_configuracion = 1) THEN 1
    ELSE 0 END)`;

const COLUMNAS = `
    e.id_encargo, e.id_sucursal, s.nombre_sucursal, e.nombre_cliente, e.celular_cliente, e.tipo_evento,
    to_char(e.fecha_entrega, 'YYYY-MM-DD') AS fecha, to_char(e.fecha_entrega, 'HH24:MI') AS hora,
    e.a_domicilio, e.direccion_entrega, e.observaciones, e.adelanto, e.estado,
    to_char(e.fecha_registro, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_registro,
    to_char(e.fecha_entregado, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_entregado,
    u.nombre_completo AS registrado_por, ue.nombre_completo AS entregado_por,
    (e.estado = 'Recibido' AND e.fecha_entrega < LOCALTIMESTAMP) AS atrasado,
    d.total, d.items`;

const DESDE = `
    FROM encargo e
    JOIN sucursal s ON s.id_sucursal = e.id_sucursal
    JOIN usuario u  ON u.id_usuario  = e.id_usuario
    LEFT JOIN usuario ue ON ue.id_usuario = e.id_usuario_entrega
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(de.subtotal), 0) AS total,
               COALESCE(json_agg(json_build_object(
                   'id_producto', de.id_producto, 'descripcion', COALESCE(p.nombre_producto, de.descripcion),
                   'personalizado', de.id_producto IS NULL, 'detalle', de.detalle, 'cantidad', de.cantidad,
                   'precio_unitario', de.precio_unitario, 'subtotal', de.subtotal) ORDER BY de.id_detalle), '[]') AS items
        FROM detalle_encargo de
        LEFT JOIN producto p ON p.id_producto = de.id_producto
        WHERE de.id_encargo = e.id_encargo
    ) d`;

const formatear = (e) => {
    const total = Number(e.total), adelanto = Number(e.adelanto);
    return {
        ...e, total, adelanto,
        saldo: Math.max(Math.round((total - adelanto) * 100) / 100, 0),
        items: e.items.map(i => ({ ...i, precio_unitario: Number(i.precio_unitario), subtotal: Number(i.subtotal) }))
    };
};

// ─── Consultas ───

/** filtro: { id_sucursal (null = todas), desde, hasta (AAAA-MM-DD), estado, texto, limite } */
const listar = async ({ id_sucursal = null, desde = null, hasta = null, estado = null, texto = null, limite = 500 } = {}) => {
    const r = await db.query(`
        SELECT ${COLUMNAS} ${DESDE}
        WHERE ($1::int IS NULL OR e.id_sucursal = $1)
          AND ($2::date IS NULL OR e.fecha_entrega >= $2::date)
          AND ($3::date IS NULL OR e.fecha_entrega < $3::date + 1)
          AND ($4::text IS NULL OR e.estado = $4)
          AND ($5::text IS NULL OR e.nombre_cliente ILIKE '%' || $5 || '%' OR e.celular_cliente LIKE '%' || $5 || '%')
        ORDER BY e.fecha_entrega, e.id_encargo
        LIMIT $6`, [id_sucursal, desde, hasta, estado, texto, limite]);
    return r.rows.map(formatear);
};

const obtener = async (id, cliente = db) => {
    const r = await cliente.query(`SELECT ${COLUMNAS} ${DESDE} WHERE e.id_encargo = $1`, [id]);
    return r.rows[0] ? formatear(r.rows[0]) : null;
};

/** Pendientes de entregar hoy (y los atrasados de días anteriores) */
const pendientesHoy = (id_sucursal = null) => listar({ id_sucursal, hasta: hoy(), estado: 'Recibido' });

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

/** Panel: hoy, próximos 7 días y saldo por cobrar de lo pendiente */
const resumen = async (id_sucursal = null) => {
    const r = await db.query(`
        SELECT COUNT(*) FILTER (WHERE e.fecha_entrega::date = CURRENT_DATE)::int AS hoy,
               COUNT(*) FILTER (WHERE e.fecha_entrega::date = CURRENT_DATE + 1)::int AS manana,
               COUNT(*) FILTER (WHERE e.fecha_entrega::date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7)::int AS semana,
               COUNT(*) FILTER (WHERE e.fecha_entrega < LOCALTIMESTAMP)::int AS atrasados,
               COUNT(*)::int AS pendientes,
               COALESCE(SUM(GREATEST(t.total - e.adelanto, 0)), 0) AS saldo,
               COALESCE(SUM(e.adelanto), 0) AS adelantos
        FROM encargo e
        CROSS JOIN LATERAL (SELECT COALESCE(SUM(subtotal), 0) AS total FROM detalle_encargo WHERE id_encargo = e.id_encargo) t
        WHERE e.estado = 'Recibido' AND ($1::int IS NULL OR e.id_sucursal = $1)`, [id_sucursal]);
    const x = r.rows[0];
    return { ...x, saldo: Number(x.saldo), adelantos: Number(x.adelantos),
             lista_hoy: await pendientesHoy(id_sucursal) };
};

// ─── Validación ───

const normalizar = (b = {}) => {
    const datos = {
        id_sucursal:     Number(b.id_sucursal) || null,
        nombre_cliente:  mayusculas(revisar(b.nombre_cliente, 'persona', { etiqueta: 'El nombre del cliente', obligatorio: true, max: 100 })),
        celular_cliente: revisar(b.celular_cliente, 'celular', { etiqueta: 'El celular', obligatorio: true }),
        tipo_evento:     String(b.tipo_evento || '').toLocaleUpperCase('es'),
        a_domicilio:     b.a_domicilio === true,
        observaciones:   revisar(b.observaciones, 'texto', { etiqueta: 'Las observaciones', max: 500, multilinea: true }),
        adelanto:        numero(b.adelanto, { etiqueta: 'El adelanto', min: 0, max: MAX_MONTO }) ?? 0
    };
    if (!TIPOS_EVENTO.includes(datos.tipo_evento)) throw new ErrorValidacion('Elige el tipo de evento.');
    if (!FECHA.test(b.fecha || '') || isNaN(Date.parse(b.fecha))) throw new ErrorValidacion('La fecha de entrega es obligatoria.');
    if (!HORA.test(b.hora || '')) throw new ErrorValidacion('La hora de entrega es obligatoria.');
    datos.fecha_entrega = `${b.fecha} ${b.hora}`;
    datos.fecha = b.fecha;
    datos.direccion_entrega = datos.a_domicilio
        ? revisar(b.direccion_entrega, 'direccion', { etiqueta: 'La dirección de entrega', obligatorio: true, max: 200 })
        : null;

    if (!Array.isArray(b.items) || !b.items.length) throw new ErrorValidacion('Agrega al menos un producto.');
    if (b.items.length > MAX_LINEAS) throw new ErrorValidacion(`Máximo ${MAX_LINEAS} productos por encargo.`);
    datos.items = b.items.map((i, n) => {
        const id_producto = Number(i?.id_producto) || null;
        const etiqueta = `Producto ${n + 1}`;
        return {
            id_producto,
            descripcion: id_producto ? null
                : mayusculas(revisar(i?.descripcion, 'nombre', { etiqueta: `${etiqueta}: el nombre`, obligatorio: true, max: 100 })),
            detalle: revisar(i?.detalle, 'texto', { etiqueta: `${etiqueta}: el detalle`, max: 300 }),
            cantidad: numero(i?.cantidad, { etiqueta: `${etiqueta}: la cantidad`, obligatorio: true, min: 1, max: 10000, entero: true }),
            precio_unitario: numero(i?.precio_unitario, { etiqueta: `${etiqueta}: el precio`, obligatorio: true, min: 0, max: MAX_MONTO })
        };
    });
    const total = datos.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    if (datos.adelanto > Math.round(total * 100) / 100) throw new ErrorValidacion('El adelanto no puede ser mayor que el total.');
    return datos;
};

// ─── Escritura ───

/** Crea (id null) o modifica un encargo Recibido. Devuelve el encargo guardado. */
const guardar = async (datos, id = null, id_usuario) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let anterior = null;
        if (id) {
            anterior = (await client.query(
                `SELECT estado, to_char(fecha_entrega, 'YYYY-MM-DD HH24:MI') AS fecha_entrega FROM encargo WHERE id_encargo = $1 FOR UPDATE`,
                [id])).rows[0];
            if (!anterior) throw error('NO_EXISTE', 'El encargo no existe.');
            if (anterior.estado !== 'Recibido') throw error('INVALIDA', 'Un encargo entregado no se puede modificar.');
        }
        const cambiaFecha = !anterior || anterior.fecha_entrega !== datos.fecha_entrega;
        if (cambiaFecha && datos.fecha < hoy()) throw error('INVALIDA', 'La fecha de entrega no puede ser un día pasado.');

        const suc = (await client.query(`SELECT estado_activo FROM sucursal WHERE id_sucursal = $1`, [datos.id_sucursal])).rows[0];
        if (!suc) throw error('INVALIDA', 'Elige la sucursal.');
        if (!suc.estado_activo && (!id || cambiaFecha)) throw error('INVALIDA', 'La sucursal está inactiva.');

        const ids = [...new Set(datos.items.filter(i => i.id_producto).map(i => i.id_producto))];
        if (ids.length) {
            const r = await client.query(`SELECT COUNT(*)::int AS n FROM producto WHERE id_producto = ANY($1::int[])`, [ids]);
            if (r.rows[0].n !== ids.length) throw error('INVALIDA', 'Un producto ya no existe.');
        }

        const campos = [datos.id_sucursal, datos.nombre_cliente, datos.celular_cliente, datos.tipo_evento,
                        datos.fecha_entrega, datos.a_domicilio, datos.direccion_entrega, datos.observaciones, datos.adelanto];
        if (id) {
            // Si cambia la fecha, los avisos vuelven a salir según la fecha nueva
            await client.query(`
                UPDATE encargo SET id_sucursal = $1, nombre_cliente = $2, celular_cliente = $3, tipo_evento = $4,
                       fecha_entrega = $5, a_domicilio = $6, direccion_entrega = $7, observaciones = $8, adelanto = $9,
                       aviso = CASE WHEN $11::boolean THEN ${NIVEL_AVISO('$5::timestamp')} ELSE aviso END
                WHERE id_encargo = $10`, [...campos, id, cambiaFecha]);
            await client.query(`DELETE FROM detalle_encargo WHERE id_encargo = $1`, [id]);
        } else {
            // Quien lo registra ya sabe: los avisos que ya habrían pasado no se mandan
            id = (await client.query(`
                INSERT INTO encargo (id_sucursal, nombre_cliente, celular_cliente, tipo_evento, fecha_entrega,
                                     a_domicilio, direccion_entrega, observaciones, adelanto, id_usuario, aviso)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${NIVEL_AVISO('$5::timestamp')})
                RETURNING id_encargo`, [...campos, id_usuario])).rows[0].id_encargo;
        }
        await client.query(`
            INSERT INTO detalle_encargo (id_encargo, id_producto, descripcion, detalle, cantidad, precio_unitario)
            SELECT $1, x.id_producto, x.descripcion, x.detalle, x.cantidad, x.precio_unitario
            FROM json_to_recordset($2::json) AS x(id_producto int, descripcion text, detalle text, cantidad int, precio_unitario numeric)`,
            [id, JSON.stringify(datos.items)]);

        const encargo = await obtener(id, client);
        await client.query('COMMIT');
        return encargo;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/** Marca o desmarca la entrega */
const cambiarEstado = async (id, entregado, id_usuario) => {
    const r = await db.query(`
        UPDATE encargo SET estado = $2,
               fecha_entregado    = CASE WHEN $2 = 'Entregado' THEN CURRENT_TIMESTAMP END,
               id_usuario_entrega = CASE WHEN $2 = 'Entregado' THEN $3::int END
        WHERE id_encargo = $1 AND estado <> $2 RETURNING id_encargo`,
        [id, entregado ? 'Entregado' : 'Recibido', id_usuario]);
    if (!r.rowCount) throw error('INVALIDA', entregado ? 'El encargo ya estaba entregado.' : 'El encargo no estaba entregado.');
    return obtener(id);
};

const eliminar = async (id) => {
    const r = await db.query(`DELETE FROM encargo WHERE id_encargo = $1 AND estado = 'Recibido' RETURNING id_encargo`, [id]);
    if (!r.rowCount) throw error('INVALIDA', 'Solo se eliminan encargos que aún no se entregaron.');
};

/** Sucursal del encargo (para revisar permisos) */
const sucursalDe = async (id) =>
    (await db.query(`SELECT id_sucursal FROM encargo WHERE id_encargo = $1`, [id])).rows[0]?.id_sucursal ?? null;

// ─── Avisos (campana y Telegram), desde cierreDiario ───
// Uno por sucursal: el anticipado (configurable en Parámetros) y el del día de entrega (desde las 06:00).
const avisos = async () => {
    const r = await db.query(`
        SELECT e.id_sucursal, s.nombre_sucursal, n.nivel,
               array_agg(e.id_encargo ORDER BY e.fecha_entrega) AS ids,
               json_agg(json_build_object('dia', to_char(e.fecha_entrega, 'DD/MM'), 'hora', to_char(e.fecha_entrega, 'HH24:MI'),
                                          'cliente', e.nombre_cliente) ORDER BY e.fecha_entrega) AS lista
        FROM encargo e
        JOIN sucursal s ON s.id_sucursal = e.id_sucursal
        CROSS JOIN LATERAL (SELECT ${NIVEL_AVISO()} AS nivel) n
        WHERE e.estado = 'Recibido' AND n.nivel > e.aviso AND e.fecha_entrega >= CURRENT_DATE AND LOCALTIME >= $1::time
        GROUP BY e.id_sucursal, s.nombre_sucursal, n.nivel`, [HORA_AVISO_DEL_DIA]);

    for (const g of r.rows) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const delDia = g.nivel === 2, n = g.lista.length;
            await notificacionModel.crear(client, {
                tipo: 'ENCARGO', destino: 'SUCURSAL', id_sucursal: g.id_sucursal, ruta: 'encargos',
                titulo:  `${delDia ? 'Para hoy' : 'Próximos'}: ${n} ${n === 1 ? 'encargo' : 'encargos'} en ${g.nombre_sucursal}`,
                mensaje: g.lista.map(x => `${delDia ? '' : x.dia + ' '}${x.hora} ${x.cliente}`).join(', ')
            });
            await client.query(`UPDATE encargo SET aviso = GREATEST(aviso, $2) WHERE id_encargo = ANY($1::int[])`, [g.ids, g.nivel]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('avisos de encargos:', e.message);
        } finally {
            client.release();
        }
    }
};

module.exports = {
    TIPOS_EVENTO, listar, obtener, pendientesHoy, resumen, normalizar, guardar, cambiarEstado, eliminar, sucursalDe, avisos
};
