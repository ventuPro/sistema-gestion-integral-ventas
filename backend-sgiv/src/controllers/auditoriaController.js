const auditoriaModel = require('../models/auditoriaModel');

// ─── Ajustes → Auditoría (solo administrador, solo lectura) ───
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const USUARIO = /^(u:\d{1,9}|sistema|cliente|directo)$/;

const hoyBolivia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());

const esFecha = (f) => FECHA.test(f) && !isNaN(new Date(`${f}T00:00:00Z`));

/** Lee y valida los filtros comunes; devuelve { error } o los filtros */
const leerFiltros = (q, { porDefecto, maximo }) => {
    const desde = q.desde || hoyBolivia();
    const hasta = q.hasta || desde;
    if (!esFecha(desde) || !esFecha(hasta)) return { error: 'Fecha inválida' };
    if (desde > hasta) return { error: 'La fecha inicial no puede ser posterior a la final' };
    if (q.usuario && !USUARIO.test(q.usuario)) return { error: 'Usuario inválido' };
    const antes = q.antes ? Number(q.antes) : null;
    if (antes !== null && (!Number.isSafeInteger(antes) || antes <= 0)) return { error: 'Página inválida' };
    const por = q.por_pagina ? Number(q.por_pagina) : porDefecto;
    if (!Number.isInteger(por) || por < 1 || por > maximo) return { error: 'Cantidad por página inválida' };
    const id_sucursal = q.id_sucursal ? Number(q.id_sucursal) : null;
    if (id_sucursal !== null && (!Number.isInteger(id_sucursal) || id_sucursal <= 0)) return { error: 'Sucursal inválida' };
    const texto = String(q.q || '').trim().slice(0, 100);
    return {
        desde, hasta, antes, por_pagina: por, id_sucursal,
        usuario: q.usuario || null,
        modulo:  q.modulo  ? String(q.modulo)  : null,
        accion:  q.accion  ? String(q.accion)  : null,
        tipo:    q.tipo    ? String(q.tipo)    : 'eventos',
        q: texto || null
    };
};

const responder = (fn, mensaje) => async (req, res) => {
    try {
        const r = await fn(req, res);
        if (r !== undefined) res.json(r);
    } catch (e) {
        console.error(`${mensaje}:`, e.message);
        res.status(500).json({ error: mensaje });
    }
};

const opciones = responder(() => auditoriaModel.opciones(), 'No se pudieron cargar los filtros de la auditoría');

const movimientos = responder((req, res) => {
    const f = leerFiltros(req.query, { porDefecto: 50, maximo: 500 });
    if (f.error) { res.status(400).json({ error: f.error }); return; }
    return auditoriaModel.movimientos(f);
}, 'No se pudieron cargar los movimientos');

const movimiento = responder(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id === 0) { res.status(400).json({ error: 'Movimiento inválido' }); return; }
    const m = await auditoriaModel.movimiento(id);
    if (!m) { res.status(404).json({ error: 'Movimiento no encontrado' }); return; }
    return m;
}, 'No se pudo cargar el movimiento');

const accesos = responder((req, res) => {
    const f = leerFiltros(req.query, { porDefecto: 50, maximo: 500 });
    if (f.error) { res.status(400).json({ error: f.error }); return; }
    return auditoriaModel.accesos(f);
}, 'No se pudieron cargar los accesos');

module.exports = { opciones, movimientos, movimiento, accesos };
