-- ════════════════════════════════════════════════════════════════════
--  Migración: permite eliminar mesas que tuvieron pedidos QR
--  (para BD existentes; schema.sql ya incluye estos cambios).
--
--    psql -U <usuario> -d sgiv_db -f database/migration_mesas_fk.sql
-- ════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE detalle_pedido DROP CONSTRAINT IF EXISTS detalle_pedido_id_pedido_fkey;
ALTER TABLE detalle_pedido
    ADD CONSTRAINT detalle_pedido_id_pedido_fkey
    FOREIGN KEY (id_pedido) REFERENCES pedido_mesa(id_pedido) ON DELETE CASCADE;

ALTER TABLE venta_caja DROP CONSTRAINT IF EXISTS venta_caja_id_pedido_mesa_fkey;
ALTER TABLE venta_caja
    ADD CONSTRAINT venta_caja_id_pedido_mesa_fkey
    FOREIGN KEY (id_pedido_mesa) REFERENCES pedido_mesa(id_pedido) ON DELETE SET NULL;

COMMIT;
