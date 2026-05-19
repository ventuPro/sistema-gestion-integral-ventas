-- ════════════════════════════════════════════════════════════════
-- Migración: ajustes del módulo de caja
-- Aplica si tu BD ya existe y no quieres recrear el schema.
-- ════════════════════════════════════════════════════════════════

-- 1. Asegurar columna caja_habilitada en usuario
ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS caja_habilitada BOOLEAN DEFAULT FALSE;

-- 2. Re-sincronizar el flag con el estado real del turno
--    (por si algún cajero quedó en estado inconsistente)
UPDATE usuario u
SET caja_habilitada = EXISTS (
    SELECT 1 FROM turno_caja t
    WHERE t.id_usuario_cajero = u.id_usuario
      AND t.estado_turno      = 'Abierto'
);

-- 3. Índices recomendados para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_turno_cajero_estado
    ON turno_caja (id_usuario_cajero, estado_turno);

CREATE INDEX IF NOT EXISTS idx_turno_apertura_fecha
    ON turno_caja (DATE(fecha_hora_apertura AT TIME ZONE 'America/La_Paz'));

CREATE INDEX IF NOT EXISTS idx_venta_caja_cajero_fecha
    ON venta_caja (id_usuario_cajero, DATE(fecha_venta AT TIME ZONE 'America/La_Paz'));
