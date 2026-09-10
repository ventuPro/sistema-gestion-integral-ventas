-- ════════════════════════════════════════════════════════════════════
--  RESET COMPLETO — Pastelería Ricky's (sistema desde cero)
--
--  Deja el sistema vacío con:
--    - 1 usuario admin: Brayan Richard (brayan@rickys.com / Admin123)
--    - 2 sucursales: "Sucursal 1" y "Sucursal 2"
--    - Roles base (Administrador, Cajero, Cocina)
--    - 0 productos, 0 categorías, 0 ventas, 0 turnos, 0 mesas
--
--  Aplicar:
--    psql -U <usuario> -d sgiv_db -f database/reset_completo.sql
--
--  IRREVERSIBLE. Haz backup antes:
--    pg_dump -U <usuario> sgiv_db > backup.sql
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. DATOS OPERATIVOS (orden importa por FK) ──────────────────────
TRUNCATE TABLE detalle_venta         CASCADE;
TRUNCATE TABLE venta_caja            CASCADE;
TRUNCATE TABLE turno_caja            CASCADE;

TRUNCATE TABLE detalle_pedido        CASCADE;
TRUNCATE TABLE pedido_mesa           CASCADE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='detalle_cuenta') THEN
        EXECUTE 'TRUNCATE TABLE detalle_cuenta CASCADE';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='cuenta_mesa') THEN
        EXECUTE 'TRUNCATE TABLE cuenta_mesa CASCADE';
    END IF;
END $$;

TRUNCATE TABLE mesa_local            CASCADE;
TRUNCATE TABLE notificacion_admin    CASCADE;
TRUNCATE TABLE historial_inventario  CASCADE;
TRUNCATE TABLE cliente               CASCADE;

-- ── 2. INVENTARIO, CATÁLOGO ─────────────────────────────────────────
TRUNCATE TABLE inventario_sucursal   CASCADE;
TRUNCATE TABLE promocion             CASCADE;
TRUNCATE TABLE producto              CASCADE;
TRUNCATE TABLE categoria_producto    CASCADE;

-- ── 3. USUARIOS Y PERMISOS ──────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='permiso_usuario') THEN
        EXECUTE 'TRUNCATE TABLE permiso_usuario CASCADE';
    END IF;
END $$;
TRUNCATE TABLE usuario               CASCADE;

-- ── 4. SUCURSALES ───────────────────────────────────────────────────
TRUNCATE TABLE sucursal              CASCADE;

-- ── 5. RESET DE SECUENCIAS ──────────────────────────────────────────
ALTER SEQUENCE IF EXISTS sucursal_id_sucursal_seq             RESTART WITH 1;
ALTER SEQUENCE IF EXISTS usuario_id_usuario_seq               RESTART WITH 1;
ALTER SEQUENCE IF EXISTS permiso_usuario_id_permiso_seq       RESTART WITH 1;
ALTER SEQUENCE IF EXISTS categoria_producto_id_categoria_seq  RESTART WITH 1;
ALTER SEQUENCE IF EXISTS producto_id_producto_seq             RESTART WITH 1;
ALTER SEQUENCE IF EXISTS promocion_id_promocion_seq           RESTART WITH 1;
ALTER SEQUENCE IF EXISTS inventario_sucursal_id_inventario_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS historial_inventario_id_historial_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS notificacion_admin_id_notificacion_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS mesa_local_id_mesa_seq               RESTART WITH 1;
ALTER SEQUENCE IF EXISTS pedido_mesa_id_pedido_seq            RESTART WITH 1;
ALTER SEQUENCE IF EXISTS detalle_pedido_id_detalle_pedido_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS turno_caja_id_turno_seq              RESTART WITH 1;
ALTER SEQUENCE IF EXISTS cliente_id_cliente_seq               RESTART WITH 1;
ALTER SEQUENCE IF EXISTS venta_caja_id_venta_seq              RESTART WITH 1;
ALTER SEQUENCE IF EXISTS detalle_venta_id_detalle_venta_seq   RESTART WITH 1;

-- ── 6. ROLES BASE (idempotente) ─────────────────────────────────────
INSERT INTO rol_usuario (id_rol, nombre_rol, nivel_permiso) VALUES
    (1, 'Administrador', 1),
    (2, 'Cajero',        2),
    (3, 'Cocina',        3)
ON CONFLICT (id_rol) DO UPDATE
   SET nombre_rol    = EXCLUDED.nombre_rol,
       nivel_permiso = EXCLUDED.nivel_permiso;

-- ── 7. SUCURSALES INICIALES ─────────────────────────────────────────
INSERT INTO sucursal (nombre_sucursal, direccion_fisica, telefono_contacto) VALUES
    ('Sucursal 1', 'La Paz, Bolivia', ''),
    ('Sucursal 2', 'La Paz, Bolivia', '');

-- ── 8. USUARIO ADMINISTRADOR (Brayan Richard) ───────────────────────
-- Contraseña: Admin123  (hash bcrypt salt=10)
INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash, estado_activo, caja_habilitada)
VALUES (
    1, 1,
    'Brayan Richard',
    'brayan@rickys.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    TRUE,
    FALSE
);

COMMIT;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────
SELECT 'sucursales' AS tabla, COUNT(*)::text AS filas FROM sucursal
UNION ALL SELECT 'usuarios',           COUNT(*)::text FROM usuario
UNION ALL SELECT 'categorias',         COUNT(*)::text FROM categoria_producto
UNION ALL SELECT 'productos',          COUNT(*)::text FROM producto
UNION ALL SELECT 'inventario',         COUNT(*)::text FROM inventario_sucursal
UNION ALL SELECT 'ventas',             COUNT(*)::text FROM venta_caja
UNION ALL SELECT 'turnos',             COUNT(*)::text FROM turno_caja
UNION ALL SELECT 'mesas',              COUNT(*)::text FROM mesa_local;

SELECT id_usuario, nombre_completo, correo_electronico, id_sucursal
FROM usuario;

SELECT id_sucursal, nombre_sucursal FROM sucursal ORDER BY id_sucursal;
