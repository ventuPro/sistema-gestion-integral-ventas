// ─── Número del día: las ventas y los pedidos QR empiezan en #1 cada día, en cada sucursal ───
// El id sigue siendo la clave interna (historial, auditoría, devoluciones); numero_dia es lo que ve la gente.
// El bloqueo (hasta el COMMIT de quien llama) hace que dos ventas a la vez no tomen el mismo número.
const TABLAS = {
    venta_caja:  { clave: 7101, fecha: 'fecha_venta' },
    pedido_mesa: { clave: 7102, fecha: 'fecha_pedido' }
};

const siguienteNumero = async (client, tabla, id_sucursal) => {
    const t = TABLAS[tabla];
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [t.clave, Number(id_sucursal)]);
    const r = await client.query(`
        SELECT COALESCE(MAX(numero_dia), 0) + 1 AS n FROM ${tabla}
        WHERE id_sucursal = $1 AND ${t.fecha}::date = CURRENT_DATE`, [Number(id_sucursal)]);
    return r.rows[0].n;
};

module.exports = { siguienteNumero };
