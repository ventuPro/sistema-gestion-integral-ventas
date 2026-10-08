-- ════════════════════════════════════════════════════════════════════
--  BD de AUDITORÍA (sgiv_auditoria), independiente de sgiv_db.
--  La ejecuta el backend al iniciar (src/auditoria/instalar.js).
--  Es idempotente: se puede ejecutar varias veces.
--
--  registro_acceso → cada petición a la API (sesiones, consultas, denegados).
--  registro_cambio → cada INSERT/UPDATE/DELETE/TRUNCATE en sgiv_db,
--                    escrito por los triggers de sgiv_db (postgres_fdw).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS registro_acceso (
    id_acceso       BIGSERIAL PRIMARY KEY,
    fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    evento          VARCHAR(40) NOT NULL DEFAULT 'PETICION',
    id_usuario      INT,
    usuario         VARCHAR(200),
    ip              VARCHAR(64),
    agente_usuario  TEXT,
    metodo          VARCHAR(10) NOT NULL,
    ruta            TEXT NOT NULL,
    -- Se completan una sola vez, cuando termina la petición
    estado_http     SMALLINT,
    duracion_ms     INT,
    detalle         JSONB
);

CREATE TABLE IF NOT EXISTS registro_cambio (
    id_cambio           BIGSERIAL PRIMARY KEY,
    fecha_hora          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    tabla               VARCHAR(63) NOT NULL,
    operacion           VARCHAR(8)  NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
    id_registro         TEXT,
    campos_modificados  TEXT[],
    datos_anteriores    JSONB,
    datos_nuevos        JSONB,
    id_usuario          INT,
    usuario             VARCHAR(200),
    ip                  VARCHAR(64),
    origen              TEXT,
    id_acceso           BIGINT REFERENCES registro_acceso (id_acceso),
    usuario_bd          VARCHAR(63),
    id_transaccion      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_acceso_fecha        ON registro_acceso (fecha_hora);
CREATE INDEX IF NOT EXISTS idx_acceso_usuario      ON registro_acceso (id_usuario, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_acceso_evento       ON registro_acceso (evento, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_cambio_fecha        ON registro_cambio (fecha_hora);
CREATE INDEX IF NOT EXISTS idx_cambio_usuario      ON registro_cambio (id_usuario, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_cambio_tabla        ON registro_cambio (tabla, id_registro);
CREATE INDEX IF NOT EXISTS idx_cambio_acceso       ON registro_cambio (id_acceso);

-- ─── Inmutabilidad ───
-- Los registros no se modifican ni se borran. Única excepción: completar
-- el resultado de una petición (estado, duración, usuario, evento) una vez.
CREATE OR REPLACE FUNCTION fn_impedir_cambios() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La auditoría no se puede modificar ni borrar (% en %)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION fn_completar_acceso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.estado_http IS NOT NULL
       OR NEW.id_acceso      IS DISTINCT FROM OLD.id_acceso
       OR NEW.fecha_hora     IS DISTINCT FROM OLD.fecha_hora
       OR NEW.ip             IS DISTINCT FROM OLD.ip
       OR NEW.agente_usuario IS DISTINCT FROM OLD.agente_usuario
       OR NEW.metodo         IS DISTINCT FROM OLD.metodo
       OR NEW.ruta           IS DISTINCT FROM OLD.ruta
       OR (OLD.id_usuario IS NOT NULL AND NEW.id_usuario IS DISTINCT FROM OLD.id_usuario)
       OR NEW.estado_http IS NULL THEN
        RAISE EXCEPTION 'La auditoría no se puede modificar (registro_acceso %)', OLD.id_acceso;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_cambio_inmutable
    BEFORE UPDATE OR DELETE ON registro_cambio
    FOR EACH ROW EXECUTE FUNCTION fn_impedir_cambios();
CREATE OR REPLACE TRIGGER trg_cambio_sin_truncate
    BEFORE TRUNCATE ON registro_cambio
    FOR EACH STATEMENT EXECUTE FUNCTION fn_impedir_cambios();

CREATE OR REPLACE TRIGGER trg_acceso_completar
    BEFORE UPDATE ON registro_acceso
    FOR EACH ROW EXECUTE FUNCTION fn_completar_acceso();
CREATE OR REPLACE TRIGGER trg_acceso_sin_borrar
    BEFORE DELETE ON registro_acceso
    FOR EACH ROW EXECUTE FUNCTION fn_impedir_cambios();
CREATE OR REPLACE TRIGGER trg_acceso_sin_truncate
    BEFORE TRUNCATE ON registro_acceso
    FOR EACH STATEMENT EXECUTE FUNCTION fn_impedir_cambios();

-- ─── Vistas para consultar en pgAdmin (hora de Bolivia) ───
CREATE OR REPLACE VIEW v_accesos AS
SELECT a.id_acceso,
       to_char(a.fecha_hora AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI:SS') AS fecha,
       a.evento,
       COALESCE(a.usuario, 'Sin sesión') AS usuario,
       a.ip,
       a.metodo || ' ' || a.ruta AS peticion,
       a.estado_http,
       a.duracion_ms,
       (SELECT count(*) FROM registro_cambio c WHERE c.id_acceso = a.id_acceso) AS filas_modificadas,
       a.detalle
FROM registro_acceso a;

CREATE OR REPLACE VIEW v_cambios AS
SELECT c.id_cambio,
       to_char(c.fecha_hora AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI:SS') AS fecha,
       c.usuario,
       c.operacion,
       c.tabla,
       c.id_registro,
       c.campos_modificados,
       c.datos_anteriores,
       c.datos_nuevos,
       c.origen,
       c.ip,
       c.id_acceso
FROM registro_cambio c;

CREATE OR REPLACE VIEW v_sesiones AS
SELECT id_acceso, fecha, evento, usuario, ip, detalle
FROM v_accesos
WHERE evento IN ('INICIO_SESION', 'INICIO_SESION_FALLIDO', 'CAPTCHA_INCORRECTO',
                 'BLOQUEO_POR_INTENTOS', 'CIERRE_SESION');
