-- ════════════════════════════════════════════════════════════════════
--  Migración: tabla permiso_usuario
--  Permite que el admin asigne permisos por módulo a cada cajero.
--
--  Aplica esto a tu BD existente:
--    psql -U <tu_usuario> -d sgiv_db -f database/migration_permisos.sql
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS permiso_usuario (
    id_permiso SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    modulo     VARCHAR(50) NOT NULL,
    tiene_acceso BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_usuario, modulo)
);

CREATE INDEX IF NOT EXISTS idx_permiso_usuario_id
    ON permiso_usuario (id_usuario);

-- Verificación
SELECT 'permiso_usuario_existe' AS metric,
       (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'permiso_usuario'))::text AS valor;
