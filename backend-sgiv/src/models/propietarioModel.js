const db = require('../config/db');

const listar = async () => {
    const r = await db.query(`SELECT * FROM propietario ORDER BY porcentaje_participacion DESC, id_propietario`);
    return r.rows;
};

/**
 * Crea (id = null) o actualiza un propietario. La suma de participaciones no
 * puede pasar de 100 %: se bloquea la tabla para que dos guardados a la vez
 * no la superen entre ambos.
 */
const guardar = async (id, p) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE propietario IN SHARE ROW EXCLUSIVE MODE');

        const rSuma = await client.query(
            `SELECT COALESCE(sum(porcentaje_participacion), 0) AS suma FROM propietario
             WHERE id_propietario IS DISTINCT FROM $1`, [id]);
        const disponible = 100 - Number(rSuma.rows[0].suma);
        if (p.porcentaje_participacion > disponible + 1e-9) {
            const e = new Error(`La participación supera el 100 %. Disponible: ${disponible.toFixed(2)} %`);
            e.codigo = 'SUPERA_100';
            throw e;
        }

        const valores = [p.nombre_completo, p.ci, p.cargo, p.telefono, p.correo, p.porcentaje_participacion];
        const r = id
            ? await client.query(
                `UPDATE propietario SET nombre_completo = $1, ci = $2, cargo = $3, telefono = $4, correo = $5,
                        porcentaje_participacion = $6
                 WHERE id_propietario = $7 RETURNING *`, [...valores, id])
            : await client.query(
                `INSERT INTO propietario (nombre_completo, ci, cargo, telefono, correo, porcentaje_participacion)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, valores);

        await client.query('COMMIT');
        return r.rows[0] || null;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const eliminar = async (id) => {
    const r = await db.query(`DELETE FROM propietario WHERE id_propietario = $1`, [id]);
    return r.rowCount > 0;
};

module.exports = { listar, guardar, eliminar };
