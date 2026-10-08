-- ════════════════════════════════════════════════════════════════════
--  Triggers de auditoría en sgiv_db.
--  La ejecuta el backend al iniciar (src/auditoria/instalar.js).
--
--  Cada INSERT/UPDATE/DELETE/TRUNCATE de las tablas de 'public' se escribe
--  en la BD sgiv_auditoria mediante postgres_fdw (tablas foráneas del
--  esquema 'auditoria'). Si la BD de auditoría no responde, la operación
--  falla: no se guarda nada sin dejar rastro.
--
--  El backend fija en cada conexión quién hace el cambio (sgiv.id_usuario,
--  sgiv.usuario, sgiv.ip, sgiv.origen, sgiv.id_acceso). Un cambio hecho
--  directamente en la BD (pgAdmin, psql) queda como 'Directo en la BD'.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SCHEMA IF NOT EXISTS auditoria;

CREATE OR REPLACE FUNCTION auditoria.ctx(nombre TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('sgiv.' || nombre, true), '')
$$;

-- ─── Conexión con la BD de auditoría ───
CREATE OR REPLACE FUNCTION auditoria.configurar_conexion(
    p_host TEXT, p_puerto TEXT, p_bd TEXT, p_usuario TEXT, p_clave TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'sgiv_auditoria_srv') THEN
        EXECUTE format('ALTER SERVER sgiv_auditoria_srv OPTIONS (SET host %L, SET port %L, SET dbname %L)',
                       p_host, p_puerto, p_bd);
    ELSE
        EXECUTE format('CREATE SERVER sgiv_auditoria_srv FOREIGN DATA WRAPPER postgres_fdw
                        OPTIONS (host %L, port %L, dbname %L)', p_host, p_puerto, p_bd);
    END IF;

    -- PUBLIC: también se audita lo que cualquier usuario de la BD cambie a mano
    DROP USER MAPPING IF EXISTS FOR PUBLIC SERVER sgiv_auditoria_srv;
    EXECUTE format('CREATE USER MAPPING FOR PUBLIC SERVER sgiv_auditoria_srv
                    OPTIONS (user %L, password %L)', p_usuario, p_clave);

    -- Sin id ni fecha por defecto: los asigna la BD de auditoría
    DROP FOREIGN TABLE IF EXISTS auditoria.registro_cambio;
    CREATE FOREIGN TABLE auditoria.registro_cambio (
        fecha_hora          TIMESTAMPTZ,
        tabla               VARCHAR(63),
        operacion           VARCHAR(8),
        id_registro         TEXT,
        campos_modificados  TEXT[],
        datos_anteriores    JSONB,
        datos_nuevos        JSONB,
        id_usuario          INT,
        usuario             VARCHAR(200),
        ip                  VARCHAR(64),
        origen              TEXT,
        id_acceso           BIGINT,
        usuario_bd          VARCHAR(63),
        id_transaccion      BIGINT
    ) SERVER sgiv_auditoria_srv OPTIONS (schema_name 'public', table_name 'registro_cambio');
END $$;

-- ─── Registro de cada fila modificada ───
-- TG_ARGV: columnas de la clave primaria de la tabla.
CREATE OR REPLACE FUNCTION auditoria.fn_registrar_cambio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_anterior JSONB;
    v_nuevo    JSONB;
    v_campos   TEXT[];
    v_clave    TEXT;
    v_oculto   TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN v_anterior := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_nuevo    := to_jsonb(NEW); END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key ORDER BY n.key) INTO v_campos
        FROM jsonb_each(v_nuevo) n
        WHERE n.value IS DISTINCT FROM v_anterior -> n.key;
        IF v_campos IS NULL THEN RETURN NULL; END IF;   -- UPDATE sin cambios reales
    END IF;

    -- Datos sensibles: queda constancia del cambio, no del valor
    FOREACH v_oculto IN ARRAY ARRAY['contrasena_hash'] LOOP
        IF v_anterior ? v_oculto THEN v_anterior := jsonb_set(v_anterior, ARRAY[v_oculto], '"[oculto]"'); END IF;
        IF v_nuevo    ? v_oculto THEN v_nuevo    := jsonb_set(v_nuevo,    ARRAY[v_oculto], '"[oculto]"'); END IF;
    END LOOP;

    SELECT string_agg(COALESCE(v_nuevo, v_anterior) ->> col, ',') INTO v_clave
    FROM unnest(TG_ARGV) AS col;

    INSERT INTO auditoria.registro_cambio (
        fecha_hora, tabla, operacion, id_registro, campos_modificados,
        datos_anteriores, datos_nuevos, id_usuario, usuario, ip, origen,
        id_acceso, usuario_bd, id_transaccion
    ) VALUES (
        clock_timestamp(), TG_TABLE_NAME, TG_OP, v_clave, v_campos,
        v_anterior, v_nuevo,
        auditoria.ctx('id_usuario')::INT,
        COALESCE(auditoria.ctx('usuario'), 'Directo en la BD'),
        auditoria.ctx('ip'),
        COALESCE(auditoria.ctx('origen'), 'Directo en la BD (' || COALESCE(NULLIF(current_setting('application_name', true), ''), 'sin aplicación') || ')'),
        auditoria.ctx('id_acceso')::BIGINT,
        session_user, txid_current()
    );
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION auditoria.fn_registrar_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO auditoria.registro_cambio (
        fecha_hora, tabla, operacion, id_usuario, usuario, ip, origen,
        id_acceso, usuario_bd, id_transaccion
    ) VALUES (
        clock_timestamp(), TG_TABLE_NAME, 'TRUNCATE',
        auditoria.ctx('id_usuario')::INT,
        COALESCE(auditoria.ctx('usuario'), 'Directo en la BD'),
        auditoria.ctx('ip'),
        COALESCE(auditoria.ctx('origen'), 'Directo en la BD'),
        auditoria.ctx('id_acceso')::BIGINT,
        session_user, txid_current()
    );
    RETURN NULL;
END $$;

-- ─── Activa los triggers en todas las tablas de 'public' ───
-- Se ejecuta en cada arranque: las tablas nuevas quedan auditadas solas.
CREATE OR REPLACE FUNCTION auditoria.activar_en_todas() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    t     RECORD;
    v_pk  TEXT;
    n     INT := 0;
BEGIN
    FOR t IN
        SELECT c.oid, c.relname
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    LOOP
        SELECT string_agg(quote_literal(a.attname), ', ' ORDER BY array_position(i.indkey::INT2[], a.attnum))
        INTO v_pk
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = t.oid AND i.indisprimary;

        EXECUTE format('CREATE OR REPLACE TRIGGER trg_auditoria
                        AFTER INSERT OR UPDATE OR DELETE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION auditoria.fn_registrar_cambio(%s)',
                       t.relname, COALESCE(v_pk, ''));
        EXECUTE format('CREATE OR REPLACE TRIGGER trg_auditoria_truncate
                        AFTER TRUNCATE ON public.%I
                        FOR EACH STATEMENT EXECUTE FUNCTION auditoria.fn_registrar_truncate()',
                       t.relname);
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;
