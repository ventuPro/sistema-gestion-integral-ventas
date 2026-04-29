
BEGIN;

-- 1. Historial de inventario (depende de inventario_sucursal)
TRUNCATE TABLE historial_inventario RESTART IDENTITY CASCADE;

-- 2. Detalle de ventas (depende de venta_caja)
TRUNCATE TABLE detalle_venta RESTART IDENTITY CASCADE;

-- 3. Ventas principales
TRUNCATE TABLE venta_caja RESTART IDENTITY CASCADE;

-- 4. Turnos de caja
TRUNCATE TABLE turno_caja RESTART IDENTITY CASCADE;

-- 5. Detalle de pedidos QR
TRUNCATE TABLE detalle_pedido RESTART IDENTITY CASCADE;

-- 6. Pedidos mesa
TRUNCATE TABLE pedido_mesa RESTART IDENTITY CASCADE;

-- 7. Notificaciones
TRUNCATE TABLE notificacion_admin RESTART IDENTITY CASCADE;

-- 8. Reiniciar stock del inventario a 0 (mantiene los productos)
UPDATE inventario_sucursal SET cantidad_actual = 0;

-- 9. Liberar todas las mesas
UPDATE mesa_local SET estado_mesa = 'Libre';

COMMIT;

-- Verificación
SELECT 'historial_inventario' AS tabla, COUNT(*) AS registros FROM historial_inventario
UNION ALL SELECT 'detalle_venta', COUNT(*) FROM detalle_venta
UNION ALL SELECT 'venta_caja', COUNT(*) FROM venta_caja
UNION ALL SELECT 'turno_caja', COUNT(*) FROM turno_caja;