-- ════════════════════════════════════════════════════════════════════
--  Migración: quita la verificación por app autenticadora (TOTP).
--  Solo para BD donde se ejecutó migration_mfa.sql (commit 65cd85b).
--  El login queda con CAPTCHA + contraseña.
--
--    psql -U <usuario> -d sgiv_db -f database/migration_quitar_mfa.sql
-- ════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE usuario DROP COLUMN IF EXISTS mfa_secreto;
ALTER TABLE usuario DROP COLUMN IF EXISTS mfa_activo;
ALTER TABLE usuario DROP COLUMN IF EXISTS mfa_ultimo_paso;

COMMIT;
