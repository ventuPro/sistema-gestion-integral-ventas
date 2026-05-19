-- ════════════════════════════════════════════════════════════════════
--  RESET DEL SISTEMA — Pastelería Ricky's
--  ─────────────────────────────────────────────────────────────────────
--  Limpia todos los datos operativos (ventas, turnos, mesas, pedidos,
--  cuentas, notificaciones, historial, clientes, cajeros y cocina).
--  PRESERVA: sucursales, roles, productos, categorías, promociones,
--            inventario_sucursal (entradas; las cantidades se resetean)
--            y los USUARIOS con id_rol = 1 (administradores).
--
--  Cómo aplicar:
--    psql -U <tu_usuario> -d sgiv_db -f database/reset.sql
--
--  ¡IMPORTANTE!  Esta acción es IRREVERSIBLE. Haz un backup antes:
--    pg_dump -U <tu_usuario> sgiv_db > backup_antes_reset.sql
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Datos de VENTAS (orden importa por FK) ───────────────────────
TRUNCATE TABLE detalle_venta CASCADE;
TRUNCATE TABLE venta_caja    CASCADE;

-- ── 2. Datos de TURNOS / CAJA ───────────────────────────────────────
TRUNCATE TABLE turno_caja CASCADE;

-- ── 3. Datos de PEDIDOS DE MESA (menú digital) ──────────────────────
TRUNCATE TABLE detalle_pedido CASCADE;
TRUNCATE TABLE pedido_mesa    CASCADE;

-- ── 4. Datos de CUENTAS (puntoventa de mesas) ───────────────────────
-- Estas tablas pueden no existir si nunca se usó cuentas; usamos
-- DO bloque para evitar error si la tabla no está creada.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detalle_cuenta') THEN
        EXECUTE 'TRUNCATE TABLE detalle_cuenta CASCADE';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cuenta_mesa') THEN
        EXECUTE 'TRUNCATE TABLE cuenta_mesa CASCADE';
    END IF;
END $$;

-- ── 5. MESAS (se vuelven a configurar manualmente) ──────────────────
TRUNCATE TABLE mesa_local CASCADE;

-- ── 6. NOTIFICACIONES e HISTORIAL ───────────────────────────────────
TRUNCATE TABLE notificacion_admin   CASCADE;
TRUNCATE TABLE historial_inventario CASCADE;

-- ── 7. CLIENTES ─────────────────────────────────────────────────────
TRUNCATE TABLE cliente CASCADE;

-- ── 8. INVENTARIO: resetea cantidades a 0 (preserva entradas) ───────
UPDATE inventario_sucursal
SET cantidad_actual = 0;

-- ── 9. PERMISOS PERSONALIZADOS de usuarios no-admin (si la tabla existe)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'permiso_usuario') THEN
        EXECUTE 'DELETE FROM permiso_usuario WHERE id_usuario NOT IN (SELECT id_usuario FROM usuario WHERE id_rol = 1)';
    END IF;
END $$;

-- ── 10. USUARIOS: eliminar todos los NO administradores ─────────────
DELETE FROM usuario
WHERE id_rol <> 1;

-- ── 11. Resetear flag caja_habilitada en todos los admins ───────────
UPDATE usuario
SET caja_habilitada = FALSE;

-- ── 12. Resetear secuencias para que los IDs vuelvan a empezar ──────
ALTER SEQUENCE IF EXISTS venta_caja_id_venta_seq             RESTART WITH 1;
ALTER SEQUENCE IF EXISTS detalle_venta_id_detalle_venta_seq  RESTART WITH 1;
ALTER SEQUENCE IF EXISTS turno_caja_id_turno_seq             RESTART WITH 1;
ALTER SEQUENCE IF EXISTS pedido_mesa_id_pedido_seq           RESTART WITH 1;
ALTER SEQUENCE IF EXISTS detalle_pedido_id_detalle_pedido_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS mesa_local_id_mesa_seq              RESTART WITH 1;
ALTER SEQUENCE IF EXISTS notificacion_admin_id_notificacion_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS historial_inventario_id_historial_seq  RESTART WITH 1;
ALTER SEQUENCE IF EXISTS cliente_id_cliente_seq               RESTART WITH 1;

-- (No tocamos las secuencias de usuario, sucursal, producto, categoría)

COMMIT;

-- ── Verificación final ───────────────────────────────────────────────
SELECT 'usuarios_restantes' AS metric, COUNT(*)::text AS valor FROM usuario
UNION ALL SELECT 'turnos_restantes',  COUNT(*)::text FROM turno_caja
UNION ALL SELECT 'ventas_restantes',  COUNT(*)::text FROM venta_caja
UNION ALL SELECT 'mesas_restantes',   COUNT(*)::text FROM mesa_local
UNION ALL SELECT 'pedidos_restantes', COUNT(*)::text FROM pedido_mesa;

-- Mostrar admin(s) preservados
SELECT id_usuario, nombre_completo, correo_electronico
FROM usuario WHERE id_rol = 1;
