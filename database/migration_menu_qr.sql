-- ════════════════════════════════════════════════════════════════════
--  Migración: menú digital QR atendido por el cajero (sin módulo cocina)
--  y base para pedidos a delivery. Para BD existentes; schema.sql ya
--  incluye estos cambios.
--
--    psql -U <usuario> -d sgiv_db -f database/migration_menu_qr.sql
--
--  · Pedidos: estados Pendiente_Cajero → Confirmado → Entregado → Pagado
--    (o Cancelado); se vinculan a la cuenta de la mesa al confirmarse.
--  · Pedidos preparados para delivery: tipo_pedido, sucursal propia y
--    datos de contacto del cliente (la mesa pasa a ser opcional).
--  · Cada mesa recibe un código QR aleatorio: la URL del menú ya no usa
--    el id interno (que se podía adivinar). Los QR impresos antes de esta
--    migración dejan de funcionar y deben reimprimirse.
--  · Se elimina el módulo de cocina (rol y columnas de estado de cocina).
-- ════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── Pedidos ───
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS tipo_pedido         VARCHAR(20) NOT NULL DEFAULT 'Mesa';
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS id_sucursal         INT REFERENCES sucursal(id_sucursal);
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS id_cuenta           INT REFERENCES cuenta_mesa(id_cuenta) ON DELETE SET NULL;
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS id_usuario_atencion INT REFERENCES usuario(id_usuario);
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS nombre_cliente      VARCHAR(100);
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS telefono_cliente    VARCHAR(20);
ALTER TABLE pedido_mesa ADD COLUMN IF NOT EXISTS direccion_entrega   TEXT;

UPDATE pedido_mesa pm SET id_sucursal = m.id_sucursal
FROM mesa_local m
WHERE pm.id_mesa = m.id_mesa AND pm.id_sucursal IS NULL;

-- Estados del flujo anterior (con cocina) al flujo nuevo
UPDATE pedido_mesa SET estado_pedido = 'Pendiente_Cajero' WHERE estado_pedido IN ('Pendiente') OR estado_pedido IS NULL;
UPDATE pedido_mesa SET estado_pedido = 'Confirmado'       WHERE estado_pedido = 'En_Cocina';
UPDATE pedido_mesa SET estado_pedido = 'Entregado'        WHERE estado_pedido = 'Listo';

ALTER TABLE pedido_mesa ALTER COLUMN estado_pedido SET DEFAULT 'Pendiente_Cajero';
ALTER TABLE pedido_mesa ALTER COLUMN estado_pedido SET NOT NULL;

ALTER TABLE pedido_mesa DROP CONSTRAINT IF EXISTS pedido_mesa_estado_check;
ALTER TABLE pedido_mesa ADD CONSTRAINT pedido_mesa_estado_check
    CHECK (estado_pedido IN ('Pendiente_Cajero', 'Confirmado', 'Entregado', 'Pagado', 'Cancelado'));

ALTER TABLE pedido_mesa DROP CONSTRAINT IF EXISTS pedido_mesa_tipo_check;
ALTER TABLE pedido_mesa ADD CONSTRAINT pedido_mesa_tipo_check
    CHECK (tipo_pedido IN ('Mesa', 'Delivery') AND (tipo_pedido <> 'Mesa' OR id_mesa IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_pedido_sucursal_estado ON pedido_mesa (id_sucursal, estado_pedido);
CREATE INDEX IF NOT EXISTS idx_pedido_mesa_estado     ON pedido_mesa (id_mesa, estado_pedido);
CREATE INDEX IF NOT EXISTS idx_pedido_cuenta          ON pedido_mesa (id_cuenta);

-- ─── Detalle de pedido: sin estados de cocina ───
ALTER TABLE detalle_pedido DROP COLUMN IF EXISTS estado_cocina;
ALTER TABLE detalle_pedido DROP COLUMN IF EXISTS nota_cocina;

-- ─── Una sola cuenta abierta por mesa ───
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_abierta_mesa ON cuenta_mesa (id_mesa) WHERE estado = 'Abierta';

-- ─── Código QR aleatorio por mesa ───
-- Solo los códigos del formato anterior (volver a ejecutar no invalida QR ya impresos)
UPDATE mesa_local SET codigo_qr = replace(gen_random_uuid()::text, '-', '')
WHERE codigo_qr IS NULL OR codigo_qr !~ '^[0-9a-f]{32}$';
ALTER TABLE mesa_local ALTER COLUMN codigo_qr SET NOT NULL;

-- ─── Eliminar el rol Cocina ───
-- Si quedara algún usuario con ese rol, pasa a Cajero desactivado.
UPDATE usuario SET id_rol = 2, estado_activo = FALSE
WHERE id_rol IN (SELECT id_rol FROM rol_usuario WHERE nombre_rol = 'Cocina');
DELETE FROM rol_usuario WHERE nombre_rol = 'Cocina';

COMMIT;
