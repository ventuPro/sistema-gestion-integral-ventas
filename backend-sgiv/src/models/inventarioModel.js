const db = require('../config/db');

// Función para registrar un movimiento (Entrada o Salida)
const registrarMovimiento = async (datos) => {
    const { id_sucursal, id_producto, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento } = datos;
    
    // Si es una salida, la cantidad a sumar al stock debe ser negativa
    const cantidadAfectar = tipo_movimiento === 'SALIDA' ? -cantidad_movida : cantidad_movida;

    // Iniciar una transacción (para asegurar que si algo falla, no se guarde nada a medias)
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Actualizar o Insertar en el inventario de la sucursal
        const queryInventario = `
            INSERT INTO inventario_sucursal (id_sucursal, id_producto, cantidad_actual)
            VALUES ($1, $2, $3)
            ON CONFLICT (id_sucursal, id_producto)
            DO UPDATE SET cantidad_actual = inventario_sucursal.cantidad_actual + EXCLUDED.cantidad_actual
            RETURNING id_inventario, cantidad_actual;
        `;
        const resInventario = await client.query(queryInventario, [id_sucursal, id_producto, cantidadAfectar]);
        const id_inventario = resInventario.rows[0].id_inventario;

        // 2. Registrar el historial de quién hizo qué
        const queryHistorial = `
            INSERT INTO historial_inventario (id_inventario, id_usuario, tipo_movimiento, cantidad_movida, motivo_movimiento)
            VALUES ($1, $2, $3, $4, $5);
        `;
        await client.query(queryHistorial, [id_inventario, id_usuario, tipo_movimiento, Math.abs(cantidad_movida), motivo_movimiento]);

        await client.query('COMMIT'); // Confirmar los cambios
        return resInventario.rows[0]; // Devolvemos cómo quedó el stock
    } catch (error) {
        await client.query('ROLLBACK'); // Si hay error, deshacer todo
        throw error;
    } finally {
        client.release();
    }
};

// Función para ver el inventario actual de una sucursal
const obtenerInventarioPorSucursal = async (id_sucursal) => {
    const query = `
        SELECT i.id_inventario, i.cantidad_actual, i.stock_minimo_alerta, p.nombre_producto, p.precio_unitario, c.nombre_categoria
        FROM inventario_sucursal i
        JOIN producto p ON i.id_producto = p.id_producto
        JOIN categoria_producto c ON p.id_categoria = c.id_categoria
        WHERE i.id_sucursal = $1;
    `;
    const result = await db.query(query, [id_sucursal]);
    return result.rows;
};

module.exports = { registrarMovimiento, obtenerInventarioPorSucursal };