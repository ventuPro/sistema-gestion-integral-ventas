-- ════════════════════════════════════════════════════════════════════
--  Migración: login con CAPTCHA + verificación en dos pasos (TOTP).
--  Para BD existentes; schema.sql ya incluye estos cambios.
--
--    psql -U <usuario> -d sgiv_db -f database/migration_mfa.sql
--
--  · Todos los usuarios configuran su app autenticadora (Google o
--    Microsoft Authenticator) en el siguiente ingreso.
--  · mfa_ultimo_paso evita que un mismo código se use dos veces.
-- ════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS mfa_secreto     VARCHAR(255);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS mfa_activo      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS mfa_ultimo_paso BIGINT;

COMMIT;
