-- ════════════════════════════════════════════════════════════════════
--  CONSULTAS DE AUDITORÍA — SGIV
--
--  Cómo usarlo en pgAdmin:
--    1. Conectarse a la BD sgiv_auditoria → clic derecho → Query Tool.
--    2. Abrir este archivo (ícono de carpeta).
--    3. Seleccionar UNA consulta con el mouse y presionar F5.
--       (Sin selección, F5 ejecuta todo el archivo y solo muestra el último resultado.)
--    4. Los valores marcados con  ◄  se cambian por los que se quieran buscar.
--
--  Tablas:  registro_acceso  → cada petición a la API (sesiones, consultas, operaciones)
--           registro_cambio  → cada INSERT/UPDATE/DELETE en sgiv_db, con datos antes/después
--  Vistas:  v_accesos, v_cambios, v_sesiones (fechas en hora de Bolivia)
--
--  Consultas agrupadas: las consultas GET exitosas que se repiten (misma sesión,
--  IP, navegador y ruta, dentro de 10 minutos) quedan en UNA fila:
--    veces = cuántas peticiones fueron, fecha = la primera, hasta = la última.
--  Inicios/cierres de sesión, rechazos, errores y toda operación que modifica
--  datos tienen siempre su propia fila. Nada se borra.
--
--  sesion = huella de la sesión (no es el token). Todas las peticiones de un
--  mismo inicio de sesión llevan la misma huella: sirve para seguir lo que hizo.
--
--  La sección 11 se ejecuta en sgiv_db, no aquí.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════ 1. ESTADO DE LA AUDITORÍA ════════════════════

-- 1.1 Base de datos actual y su tamaño
SELECT current_database() AS base_de_datos,
       pg_size_pretty(pg_database_size(current_database())) AS tamano;

-- 1.2 Tablas y vistas de auditoría
SELECT table_name AS nombre, table_type AS tipo
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_type, table_name;

-- 1.3 Triggers que impiden modificar o borrar la auditoría
SELECT event_object_table AS tabla, trigger_name, action_timing AS momento,
       string_agg(event_manipulation, ', ') AS operaciones
FROM information_schema.triggers
WHERE trigger_schema = 'public'
GROUP BY 1, 2, 3 ORDER BY 1, 2;

-- 1.4 Totales: filas guardadas, peticiones reales y primer/último registro
SELECT (SELECT count(*)          FROM registro_acceso) AS filas_de_accesos,
       (SELECT sum(repeticiones) FROM registro_acceso) AS peticiones_registradas,
       (SELECT count(*)          FROM registro_cambio) AS cambios_en_datos,
       (SELECT to_char(min(fecha_hora) AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI') FROM registro_acceso) AS primer_registro,
       (SELECT to_char(max(COALESCE(fecha_hora_ultima, fecha_hora)) AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI')
          FROM registro_acceso) AS ultimo_registro;

-- 1.5 Crecimiento por día (filas guardadas vs. peticiones que representan)
SELECT (fecha_hora AT TIME ZONE 'America/La_Paz')::date AS dia,
       count(*)          AS filas,
       sum(repeticiones) AS peticiones,
       count(*) FILTER (WHERE repeticiones > 1) AS filas_agrupadas
FROM registro_acceso
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;


-- ════════════════════ 2. SESIONES ════════════════════

-- 2.1 Últimos inicios y cierres de sesión, intentos fallidos y bloqueos
SELECT * FROM v_sesiones ORDER BY id_acceso DESC LIMIT 50;

-- 2.2 Resumen por tipo de evento
SELECT evento, count(*) AS cantidad, max(fecha) AS ultima_vez
FROM v_sesiones GROUP BY evento ORDER BY cantidad DESC;

-- 2.3 Intentos fallidos por correo e IP (posibles intentos de adivinar contraseñas)
SELECT detalle ->> 'correo' AS correo_intentado, ip, evento,
       count(*) AS intentos, min(fecha) AS primer_intento, max(fecha) AS ultimo_intento
FROM v_sesiones
WHERE evento IN ('INICIO_SESION_FALLIDO', 'CAPTCHA_INCORRECTO', 'BLOQUEO_POR_INTENTOS')
GROUP BY 1, 2, 3 ORDER BY ultimo_intento DESC;

-- 2.4 Último inicio de sesión de cada usuario
SELECT usuario, max(fecha) AS ultimo_inicio_sesion, count(*) AS veces
FROM v_sesiones WHERE evento = 'INICIO_SESION'
GROUP BY usuario ORDER BY ultimo_inicio_sesion DESC;

-- 2.5 Sesiones de hoy: quién, desde dónde, cuándo empezó y su última actividad
SELECT s.usuario, s.ip, s.sesion,
       s.fecha AS inicio,
       (SELECT to_char(max(COALESCE(a.fecha_hora_ultima, a.fecha_hora)) AT TIME ZONE 'America/La_Paz', 'HH24:MI:SS')
          FROM registro_acceso a WHERE a.sesion = s.sesion) AS ultima_actividad,
       (SELECT sum(a.repeticiones) FROM registro_acceso a WHERE a.sesion = s.sesion) AS peticiones,
       EXISTS (SELECT 1 FROM v_sesiones c WHERE c.sesion = s.sesion AND c.evento = 'CIERRE_SESION') AS cerro_sesion
FROM v_sesiones s
WHERE s.evento = 'INICIO_SESION'
  AND s.fecha LIKE to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') || '%'
ORDER BY s.id_acceso DESC;


-- ════════════════════ 3. SEGUIR A UNA SESIÓN, UN USUARIO O UNA IP ════════════════════

-- 3.1 Todo lo que se hizo en UNA sesión, en orden (huella de la consulta 2.5)
SELECT id_acceso, fecha, hasta, veces, evento, peticion, estado_http, filas_modificadas
FROM v_accesos
WHERE sesion = 'c325214f59aae1ee'                                   -- ◄ huella de la sesión
ORDER BY id_acceso;

-- 3.2 Todo lo que hizo un usuario entre dos fechas (sin consultas GET)
SELECT id_acceso, fecha, evento, ip, peticion, estado_http, filas_modificadas
FROM v_accesos
WHERE usuario LIKE '%admin@rickys.com%'                              -- ◄ correo del usuario
  AND fecha_hora >= '2026-10-01' AND fecha_hora < '2026-11-01'      -- ◄ rango de fechas
  AND metodo <> 'GET'
ORDER BY id_acceso;

-- 3.3 Lo que hizo HOY el último usuario que inició sesión (sin consultas GET)
SELECT id_acceso, fecha, peticion, estado_http, filas_modificadas
FROM v_accesos
WHERE usuario = (SELECT usuario FROM v_sesiones WHERE evento = 'INICIO_SESION'
                 ORDER BY id_acceso DESC LIMIT 1)
  AND fecha LIKE to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') || '%'
  AND metodo <> 'GET'
ORDER BY id_acceso;

-- 3.4 Actividad desde una IP (todas las sesiones y usuarios que la usaron)
SELECT ip, usuario, sesion, count(*) AS filas, sum(veces) AS peticiones,
       min(fecha) AS desde, max(COALESCE(hasta, fecha)) AS hasta
FROM v_accesos
WHERE ip = '192.168.1.10'                                           -- ◄ IP
GROUP BY ip, usuario, sesion ORDER BY desde DESC;

-- 3.5 IPs desde las que se conectó cada usuario
SELECT usuario, ip, count(*) AS inicios_de_sesion, max(fecha) AS ultima_vez
FROM v_sesiones WHERE evento = 'INICIO_SESION'
GROUP BY usuario, ip ORDER BY usuario, ultima_vez DESC;


-- ════════════════════ 4. PETICIONES A LA API ════════════════════

-- 4.1 Últimas operaciones (todo lo que no es consulta GET)
SELECT id_acceso, fecha, usuario, peticion, estado_http, duracion_ms, filas_modificadas
FROM v_accesos
WHERE metodo <> 'GET'
ORDER BY id_acceso DESC LIMIT 50;

-- 4.2 Últimas peticiones de todo tipo (incluye consultas GET agrupadas)
SELECT id_acceso, fecha, hasta, veces, evento, usuario, ip, peticion, estado_http
FROM v_accesos ORDER BY id_acceso DESC LIMIT 50;

-- 4.3 Accesos denegados (módulo sin permiso) y sesiones inválidas
SELECT id_acceso, fecha, evento, usuario, ip, peticion, estado_http
FROM v_accesos
WHERE evento IN ('ACCESO_DENEGADO', 'SESION_INVALIDA')
ORDER BY id_acceso DESC LIMIT 50;

-- 4.4 Errores del servidor
SELECT id_acceso, fecha, usuario, peticion, estado_http, detalle
FROM v_accesos WHERE evento = 'ERROR_SERVIDOR' ORDER BY id_acceso DESC;

-- 4.5 Peticiones por usuario en el mes
SELECT usuario,
       sum(veces) AS peticiones,
       count(*) FILTER (WHERE metodo <> 'GET') AS operaciones,
       count(*) FILTER (WHERE estado_http >= 400) AS rechazadas
FROM v_accesos
WHERE fecha_hora >= date_trunc('month', now())
GROUP BY 1 ORDER BY 2 DESC;

-- 4.6 Actividad por hora del día (hoy)
SELECT to_char(fecha_hora AT TIME ZONE 'America/La_Paz', 'HH24":00"') AS hora,
       sum(repeticiones) AS peticiones,
       count(*) FILTER (WHERE metodo <> 'GET') AS operaciones
FROM registro_acceso
WHERE (fecha_hora AT TIME ZONE 'America/La_Paz')::date = (now() AT TIME ZONE 'America/La_Paz')::date
GROUP BY 1 ORDER BY 1;

-- 4.7 Operaciones fuera de horario (antes de las 07:00 o después de las 22:00)
SELECT id_acceso, fecha, usuario, ip, peticion, estado_http, filas_modificadas
FROM v_accesos
WHERE metodo <> 'GET'
  AND (extract(hour FROM fecha_hora AT TIME ZONE 'America/La_Paz') < 7          -- ◄ hora de apertura
    OR extract(hour FROM fecha_hora AT TIME ZONE 'America/La_Paz') >= 22)       -- ◄ hora de cierre
ORDER BY id_acceso DESC LIMIT 50;

-- 4.8 Consultas automáticas más repetidas (las que se agrupan)
SELECT regexp_replace(split_part(peticion, '?', 1), '/[0-9]+', '/N', 'g') AS consulta,
       count(*) AS filas, sum(veces) AS peticiones, max(veces) AS maximo_en_una_fila
FROM v_accesos WHERE metodo = 'GET'
GROUP BY 1 ORDER BY peticiones DESC LIMIT 20;

-- 4.9 Peticiones más lentas
SELECT id_acceso, fecha, usuario, peticion, duracion_ms
FROM v_accesos WHERE duracion_ms IS NOT NULL
ORDER BY duracion_ms DESC LIMIT 20;


-- ════════════════════ 5. CAMBIOS EN LOS DATOS (TRIGGERS) ════════════════════

-- 5.1 Últimos cambios (doble clic en datos_anteriores / datos_nuevos para ver el JSON)
SELECT id_cambio, fecha, usuario, operacion, tabla, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios ORDER BY id_cambio DESC LIMIT 50;

-- 5.2 Cantidad de cambios por tabla y operación
SELECT tabla, operacion, count(*) AS cantidad, max(fecha) AS ultimo_cambio
FROM v_cambios GROUP BY tabla, operacion ORDER BY tabla, operacion;

-- 5.3 Registros eliminados (con los datos que tenían antes de borrarse)
SELECT fecha, usuario, tabla, id_registro, datos_anteriores, origen
FROM v_cambios WHERE operacion IN ('DELETE', 'TRUNCATE')
ORDER BY id_cambio DESC;

-- 5.4 Historial completo de UN registro (desde que se creó hasta hoy)
SELECT fecha, usuario, operacion, campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios
WHERE tabla = 'producto' AND id_registro = '1'                       -- ◄ tabla e id
ORDER BY id_cambio;

-- 5.5 Qué cambió una petición concreta (id_acceso de las consultas 3.x o 4.x)
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE id_acceso = 123                                 -- ◄ id_acceso
ORDER BY id_cambio;

-- 5.6 Detalle de la ÚLTIMA operación que modificó datos
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE id_acceso = (SELECT max(id_acceso) FROM registro_cambio)
ORDER BY id_cambio;

-- 5.7 Quién cambió un campo concreto y a qué valor (ej.: precios)
SELECT fecha, usuario, tabla, id_registro,
       datos_anteriores ->> 'precio_unitario' AS antes,                -- ◄ campo
       datos_nuevos     ->> 'precio_unitario' AS despues,
       origen
FROM v_cambios
WHERE 'precio_unitario' = ANY (campos_modificados)                   -- ◄ campo
ORDER BY id_cambio DESC;


-- ════════════════════ 6. PRODUCTOS, PRECIOS Y STOCK ════════════════════

-- 6.1 Cambios de precio de productos (antes → después)
SELECT fecha, usuario, id_registro AS id_producto,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'nombre_producto' AS producto,
       datos_anteriores ->> 'precio_unitario' AS precio_antes,
       datos_nuevos     ->> 'precio_unitario' AS precio_despues,
       origen
FROM v_cambios
WHERE tabla = 'producto' AND 'precio_unitario' = ANY (campos_modificados)
ORDER BY id_cambio DESC;

-- 6.2 Productos creados, desactivados o eliminados
SELECT fecha, usuario, operacion, id_registro AS id_producto,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'nombre_producto' AS producto,
       datos_anteriores ->> 'estado_activo' AS activo_antes,
       datos_nuevos     ->> 'estado_activo' AS activo_despues
FROM v_cambios
WHERE tabla = 'producto'
  AND (operacion IN ('INSERT', 'DELETE') OR 'estado_activo' = ANY (campos_modificados))
ORDER BY id_cambio DESC;

-- 6.3 Movimientos de stock (antes → después)
SELECT fecha, usuario, operacion,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'id_producto' AS id_producto,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'id_sucursal' AS id_sucursal,
       (datos_anteriores ->> 'cantidad_actual')::INT AS stock_antes,
       (datos_nuevos     ->> 'cantidad_actual')::INT AS stock_despues,
       (datos_nuevos ->> 'cantidad_actual')::INT - (datos_anteriores ->> 'cantidad_actual')::INT AS diferencia,
       origen
FROM v_cambios
WHERE tabla = 'inventario_sucursal'
ORDER BY id_cambio DESC LIMIT 50;

-- 6.4 Historial de inventario: ventas, entradas y mermas con su motivo y detalle
SELECT fecha, usuario,
       datos_nuevos ->> 'id_producto'       AS id_producto,
       datos_nuevos ->> 'id_sucursal'       AS id_sucursal,
       datos_nuevos ->> 'motivo_movimiento' AS motivo,
       datos_nuevos ->> 'cantidad_movida'   AS cantidad,
       datos_nuevos ->> 'detalle'           AS detalle
FROM v_cambios
WHERE tabla = 'historial_inventario' AND operacion = 'INSERT'
ORDER BY id_cambio DESC LIMIT 50;


-- ════════════════════ 7. VENTAS, CAJA Y PEDIDOS ════════════════════

-- 7.1 Ventas registradas (quién, cuánto y cómo pagó)
SELECT fecha, usuario, id_registro AS id_venta,
       datos_nuevos ->> 'monto_total_venta' AS monto,
       datos_nuevos ->> 'metodo_pago'       AS metodo_pago,
       datos_nuevos ->> 'id_turno'          AS id_turno
FROM v_cambios
WHERE tabla = 'venta_caja' AND operacion = 'INSERT'
ORDER BY id_cambio DESC LIMIT 50;

-- 7.2 Todo lo que modificó la última venta (venta, detalle y stock)
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE id_acceso = (SELECT id_acceso FROM registro_cambio
                   WHERE tabla = 'venta_caja' AND operacion = 'INSERT'
                   ORDER BY id_cambio DESC LIMIT 1)
ORDER BY id_cambio;

-- 7.3 Aperturas y cierres de turno de caja (con efectivo contado y diferencia)
SELECT fecha, usuario, operacion, id_registro AS id_turno,
       datos_nuevos ->> 'estado_turno'         AS estado,
       datos_nuevos ->> 'monto_inicial'        AS fondo,
       datos_nuevos ->> 'monto_calculado'      AS esperado,
       datos_nuevos ->> 'monto_real_declarado' AS contado,
       datos_nuevos ->> 'diferencia'           AS diferencia
FROM v_cambios WHERE tabla = 'turno_caja'
ORDER BY id_cambio DESC LIMIT 30;

-- 7.4 Cierres de caja con faltante o sobrante
SELECT fecha, usuario, id_registro AS id_turno,
       (datos_nuevos ->> 'diferencia')::numeric AS diferencia
FROM v_cambios
WHERE tabla = 'turno_caja' AND 'diferencia' = ANY (campos_modificados)
  AND (datos_nuevos ->> 'diferencia')::numeric <> 0
ORDER BY id_cambio DESC;

-- 7.5 Pedidos del menú QR (creados, confirmados, rechazados, pagados)
SELECT fecha, usuario, operacion, id_registro AS id_pedido,
       datos_anteriores ->> 'estado_pedido' AS estado_antes,
       datos_nuevos     ->> 'estado_pedido' AS estado_despues,
       origen
FROM v_cambios WHERE tabla = 'pedido_mesa'
ORDER BY id_cambio DESC LIMIT 30;


-- ════════════════════ 8. USUARIOS, PERMISOS Y AJUSTES ════════════════════

-- 8.1 Cambios en usuarios y permisos (la contraseña aparece como "[oculto]")
SELECT fecha, usuario AS hecho_por, tabla, operacion, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE tabla IN ('usuario', 'permiso_usuario')
ORDER BY id_cambio DESC LIMIT 30;

-- 8.2 Cambios de contraseña (se registra que cambió, no su valor)
SELECT fecha, usuario AS hecho_por, id_registro AS id_usuario,
       datos_nuevos ->> 'correo_electronico' AS cuenta
FROM v_cambios
WHERE tabla = 'usuario' AND 'contrasena_hash' = ANY (campos_modificados)
ORDER BY id_cambio DESC;

-- 8.3 Cambios en los ajustes del sistema, sucursales y propietarios
SELECT fecha, usuario, tabla, operacion, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE tabla IN ('configuracion', 'sucursal', 'horario_sucursal', 'propietario')
ORDER BY id_cambio DESC LIMIT 30;


-- ════════════════════ 9. CHATBOTS ════════════════════

-- 9.1 Preguntas hechas a los chatbots (quién, qué preguntó y qué datos consultó)
SELECT fecha, usuario, ip,
       detalle ->> 'asistente' AS asistente,
       detalle ->> 'pregunta'  AS pregunta,
       detalle -> 'funciones'  AS funciones_usadas,
       detalle ->> 'modelo'    AS modelo
FROM v_accesos WHERE evento = 'IA_CONSULTA'
ORDER BY id_acceso DESC LIMIT 50;


-- ════════════════════ 10. INVESTIGAR UN INCIDENTE ════════════════════

-- 10.1 Línea de tiempo de un período: peticiones y cambios de datos juntos
SELECT a.fecha, a.usuario, a.ip, a.peticion, a.estado_http,
       c.tabla, c.operacion, c.id_registro, c.campos_modificados, c.datos_anteriores, c.datos_nuevos
FROM v_accesos a
LEFT JOIN v_cambios c ON c.id_acceso = a.id_acceso
WHERE a.fecha_hora >= '2026-10-16 08:00' AND a.fecha_hora < '2026-10-16 12:00'   -- ◄ período (hora de Bolivia)
  AND (a.metodo <> 'GET' OR a.estado_http >= 400)
ORDER BY a.id_acceso, c.id_cambio;

-- 10.2 Cambios hechos directamente en la BD (pgAdmin, psql), no desde el sistema
SELECT id_cambio, fecha, usuario, operacion, tabla, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios WHERE origen LIKE 'Directo en la BD%'
ORDER BY id_cambio DESC;

-- 10.3 Buscar un texto en cualquier dato modificado (nombre, NIT, monto, etc.)
SELECT fecha, usuario, tabla, operacion, id_registro, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE datos_anteriores::text ILIKE '%torta%'                         -- ◄ texto
   OR datos_nuevos::text     ILIKE '%torta%'                         -- ◄ texto
ORDER BY id_cambio DESC LIMIT 50;


-- ════════════════════ 11. PRUEBAS EN VIVO ════════════════════

-- 11.1 INMUTABILIDAD: cada una debe dar ERROR "La auditoría no se puede modificar..."
DELETE FROM registro_cambio WHERE id_cambio = (SELECT min(id_cambio) FROM registro_cambio);

UPDATE registro_cambio SET usuario = 'otro' WHERE id_cambio = (SELECT min(id_cambio) FROM registro_cambio);

DELETE FROM registro_acceso WHERE id_acceso = (SELECT min(id_acceso) FROM registro_acceso);

UPDATE registro_acceso SET repeticiones = repeticiones + 5, fecha_hora_ultima = now()
WHERE id_acceso = (SELECT min(id_acceso) FROM registro_acceso);

TRUNCATE registro_cambio;

/* 11.2 EJECUTAR EN sgiv_db (sgiv_db → Query Tool). Copiar o seleccionar cada consulta de este bloque.

-- Triggers de auditoría instalados en cada tabla del sistema
SELECT event_object_table AS tabla, trigger_name,
       string_agg(event_manipulation, ', ') AS operaciones
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_auditoria%'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Conexión con la BD de auditoría (postgres_fdw)
SELECT srvname AS servidor, srvoptions AS opciones FROM pg_foreign_server;

-- Cambio directo en la BD: subir 1 Bs el precio del producto 1
-- (luego ver la consulta 10.2 en sgiv_auditoria)
UPDATE producto SET precio_unitario = precio_unitario + 1 WHERE id_producto = 1;

-- Devolver el precio original (también queda registrado)
UPDATE producto SET precio_unitario = precio_unitario - 1 WHERE id_producto = 1;

*/
