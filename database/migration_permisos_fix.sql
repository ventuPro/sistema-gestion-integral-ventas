-- ════════════════════════════════════════════════════════════════════
--  Migración CORRECTIVA: recrea permiso_usuario con esquema garantizado
--
--  Úsala si los permisos siguen sin guardarse pese a haber corrido
--  migration_permisos.sql — tu tabla anterior puede haber sido creada
--  con un esquema incompatible (FK rota, tipos distintos, etc).
--
--  ⚠️  Este script BORRA todos los permisos personalizados existentes.
--      Tras correrlo, el admin debe volver a asignar permisos a cada
--      cajero/cocina (los defaults del rol se aplican mientras tanto).
--
--  Cómo aplicar:
--    psql -U <tu_usuario> -d sgiv_db -f database/migration_permisos_fix.sql
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Borrar la tabla actual (si existe, con cualquier esquema)
DROP TABLE IF EXISTS permiso_usuario CASCADE;

-- 2. Crear la tabla con el esquema correcto
CREATE TABLE permiso_usuario (
    id_permiso          SERIAL PRIMARY KEY,
    id_usuario          INTEGER NOT NULL,
    modulo              VARCHAR(50) NOT NULL,
    tiene_acceso        BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT permiso_usuario_unique UNIQUE (id_usuario, modulo),
    CONSTRAINT permiso_usuario_fk_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario)
        ON DELETE CASCADE
);

CREATE INDEX idx_permiso_usuario_id ON permiso_usuario (id_usuario);

COMMIT;

-- Verificación
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'permiso_usuario'
ORDER BY ordinal_position;

SELECT 'OK: permiso_usuario recreada' AS resultado;
