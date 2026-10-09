-- ════════════════════════════════════════════════════════════════════
--  CONSULTAS DE AUDITORÍA — SGIV Pastelería Ricky's
--
--  Abrir en pgAdmin: sgiv_auditoria → Query Tool → Abrir archivo.
--  Seleccionar UNA consulta con el mouse y presionar F5.
--  (Sin selección, F5 ejecuta todo el archivo y solo muestra el último resultado.)
--
--  Tablas:  registro_acceso (peticiones y sesiones), registro_cambio (triggers)
--  Vistas:  v_accesos, v_cambios, v_sesiones (fechas en hora de Bolivia)
--  La sección 8 se ejecuta en sgiv_db, no aquí.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════ 1. ESTRUCTURA DE LA AUDITORÍA ════════════════════

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

-- 1.4 Cantidad total de registros
SELECT (SELECT count(*) FROM registro_acceso) AS total_accesos,
       (SELECT count(*) FROM registro_cambio) AS total_cambios,
       (SELECT to_char(min(fecha_hora) AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI') FROM registro_acceso) AS primer_registro,
       (SELECT to_char(max(fecha_hora) AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD HH24:MI') FROM registro_acceso) AS ultimo_registro;


-- ════════════════════ 2. SESIONES ════════════════════

-- 2.1 Últimos inicios y cierres de sesión, intentos fallidos y bloqueos
SELECT * FROM v_sesiones ORDER BY id_acceso DESC LIMIT 50;

-- 2.2 Resumen de sesiones por tipo de evento
SELECT evento, count(*) AS cantidad, max(fecha) AS ultima_vez
FROM v_sesiones GROUP BY evento ORDER BY cantidad DESC;

-- 2.3 Intentos de inicio de sesión fallidos por correo e IP
SELECT detalle ->> 'correo' AS correo_intentado, ip, evento,
       count(*) AS intentos, max(fecha) AS ultimo_intento
FROM v_sesiones
WHERE evento IN ('INICIO_SESION_FALLIDO', 'CAPTCHA_INCORRECTO', 'BLOQUEO_POR_INTENTOS')
GROUP BY 1, 2, 3 ORDER BY ultimo_intento DESC;

-- 2.4 Último acceso de cada usuario
SELECT usuario, max(fecha) AS ultimo_inicio_sesion, count(*) AS veces
FROM v_sesiones WHERE evento = 'INICIO_SESION'
GROUP BY usuario ORDER BY ultimo_inicio_sesion DESC;


-- ════════════════════ 3. PETICIONES A LA API ════════════════════

-- 3.1 Últimas operaciones (sin consultas GET)
SELECT id_acceso, fecha, usuario, peticion, estado_http, duracion_ms, filas_modificadas
FROM v_accesos
WHERE peticion NOT LIKE 'GET%'
ORDER BY id_acceso DESC LIMIT 50;

-- 3.2 Últimas peticiones de todo tipo (incluye consultas GET)
SELECT id_acceso, fecha, evento, usuario, ip, peticion, estado_http, duracion_ms
FROM v_accesos ORDER BY id_acceso DESC LIMIT 50;

-- 3.3 Todo lo que hizo HOY el último usuario que inició sesión
--     (para otro usuario: reemplazar la subconsulta por 'correo@rickys.com')
SELECT id_acceso, fecha, peticion, estado_http, filas_modificadas
FROM v_accesos
WHERE usuario = (SELECT usuario FROM v_sesiones WHERE evento = 'INICIO_SESION'
                 ORDER BY id_acceso DESC LIMIT 1)
  AND fecha LIKE to_char(now() AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') || '%'
  AND peticion NOT LIKE 'GET%'
ORDER BY id_acceso;

-- 3.4 Accesos denegados (módulo sin permiso) y sesiones inválidas
SELECT id_acceso, fecha, evento, usuario, ip, peticion, estado_http
FROM v_accesos
WHERE evento IN ('ACCESO_DENEGADO', 'SESION_INVALIDA')
ORDER BY id_acceso DESC LIMIT 50;

-- 3.5 Errores del servidor
SELECT id_acceso, fecha, usuario, peticion, estado_http, detalle
FROM v_accesos WHERE evento = 'ERROR_SERVIDOR' ORDER BY id_acceso DESC;

-- 3.6 Peticiones por usuario en el mes
SELECT COALESCE(usuario, 'Sin sesión') AS usuario, count(*) AS peticiones,
       count(*) FILTER (WHERE metodo <> 'GET') AS operaciones,
       count(*) FILTER (WHERE estado_http >= 400) AS rechazadas
FROM registro_acceso
WHERE fecha_hora >= date_trunc('month', now())
GROUP BY 1 ORDER BY 2 DESC;

-- 3.7 Actividad por hora del día (hoy)
SELECT to_char(fecha_hora AT TIME ZONE 'America/La_Paz', 'HH24":00"') AS hora,
       count(*) AS peticiones,
       count(*) FILTER (WHERE metodo <> 'GET') AS operaciones
FROM registro_acceso
WHERE (fecha_hora AT TIME ZONE 'America/La_Paz')::date = (now() AT TIME ZONE 'America/La_Paz')::date
GROUP BY 1 ORDER BY 1;

-- 3.8 Peticiones más lentas
SELECT id_acceso, fecha, usuario, peticion, duracion_ms
FROM v_accesos WHERE duracion_ms IS NOT NULL
ORDER BY duracion_ms DESC LIMIT 20;


-- ════════════════════ 4. CAMBIOS EN LOS DATOS (TRIGGERS) ════════════════════

-- 4.1 Últimos cambios (doble clic en datos_anteriores / datos_nuevos para ver el JSON)
SELECT id_cambio, fecha, usuario, operacion, tabla, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios ORDER BY id_cambio DESC LIMIT 50;

-- 4.2 Cantidad de cambios por tabla y operación
SELECT tabla, operacion, count(*) AS cantidad, max(fecha) AS ultimo_cambio
FROM v_cambios GROUP BY tabla, operacion ORDER BY tabla, operacion;

-- 4.3 Registros eliminados (con los datos que tenían antes de borrarse)
SELECT fecha, usuario, tabla, id_registro, datos_anteriores, origen
FROM v_cambios WHERE operacion IN ('DELETE', 'TRUNCATE')
ORDER BY id_cambio DESC;

-- 4.4 Detalle de la ÚLTIMA operación del sistema que modificó datos
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE id_acceso = (SELECT max(id_acceso) FROM registro_cambio)
ORDER BY id_cambio;

-- 4.5 Detalle de una petición concreta (cambiar 123 por el id_acceso de la consulta 3.1)
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE id_acceso = 123 ORDER BY id_cambio;


-- ════════════════════ 5. PRODUCTOS, PRECIOS Y STOCK ════════════════════

-- 5.1 Cambios de precio de productos (antes → después)
SELECT fecha, usuario, id_registro AS id_producto,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'nombre_producto' AS producto,
       datos_anteriores ->> 'precio_unitario' AS precio_antes,
       datos_nuevos     ->> 'precio_unitario' AS precio_despues,
       origen
FROM v_cambios
WHERE tabla = 'producto' AND 'precio_unitario' = ANY (campos_modificados)
ORDER BY id_cambio DESC;

-- 5.2 Historial completo del último producto modificado
SELECT fecha, usuario, operacion, campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios
WHERE tabla = 'producto'
  AND id_registro = (SELECT id_registro FROM registro_cambio WHERE tabla = 'producto'
                     ORDER BY id_cambio DESC LIMIT 1)
ORDER BY id_cambio;

-- 5.3 Productos creados, desactivados o eliminados
SELECT fecha, usuario, operacion, id_registro AS id_producto,
       COALESCE(datos_nuevos, datos_anteriores) ->> 'nombre_producto' AS producto,
       datos_anteriores ->> 'estado_activo' AS activo_antes,
       datos_nuevos     ->> 'estado_activo' AS activo_despues
FROM v_cambios
WHERE tabla = 'producto'
  AND (operacion IN ('INSERT', 'DELETE') OR 'estado_activo' = ANY (campos_modificados))
ORDER BY id_cambio DESC;

-- 5.4 Movimientos de stock (antes → después)
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


-- ════════════════════ 6. VENTAS, CAJA Y USUARIOS ════════════════════

-- 6.1 Ventas registradas (quién, cuánto y cómo pagó)
SELECT fecha, usuario, id_registro AS id_venta,
       datos_nuevos ->> 'monto_total_venta' AS monto,
       datos_nuevos ->> 'metodo_pago'       AS metodo_pago,
       datos_nuevos ->> 'id_turno'          AS id_turno
FROM v_cambios
WHERE tabla = 'venta_caja' AND operacion = 'INSERT'
ORDER BY id_cambio DESC LIMIT 50;

-- 6.2 Todo lo que modificó la última venta (venta, detalle y stock)
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios
WHERE id_acceso = (SELECT id_acceso FROM registro_cambio
                   WHERE tabla = 'venta_caja' AND operacion = 'INSERT'
                   ORDER BY id_cambio DESC LIMIT 1)
ORDER BY id_cambio;

-- 6.3 Aperturas y cierres de turno de caja
SELECT fecha, usuario, operacion, id_registro AS id_turno,
       campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE tabla = 'turno_caja'
ORDER BY id_cambio DESC LIMIT 30;

-- 6.4 Cambios en usuarios y permisos (la contraseña aparece como "[oculto]")
SELECT fecha, usuario AS hecho_por, tabla, operacion, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE tabla IN ('usuario', 'permiso_usuario')
ORDER BY id_cambio DESC LIMIT 30;

-- 6.5 Cambios de contraseña (se registra que cambió, no su valor)
SELECT fecha, usuario AS hecho_por, id_registro AS id_usuario,
       datos_nuevos ->> 'correo_electronico' AS cuenta,
       datos_nuevos ->> 'contrasena_hash'    AS contrasena
FROM v_cambios
WHERE tabla = 'usuario' AND 'contrasena_hash' = ANY (campos_modificados)
ORDER BY id_cambio DESC;

-- 6.6 Pedidos del menú QR (creados, confirmados, rechazados, pagados)
SELECT fecha, usuario, operacion, id_registro AS id_pedido,
       datos_anteriores ->> 'estado_pedido' AS estado_antes,
       datos_nuevos     ->> 'estado_pedido' AS estado_despues,
       origen
FROM v_cambios WHERE tabla = 'pedido_mesa'
ORDER BY id_cambio DESC LIMIT 30;


-- ════════════════════ 7. CAMBIOS HECHOS FUERA DEL SISTEMA ════════════════════

-- 7.1 Cambios hechos directamente en la BD (pgAdmin, psql), no desde el sistema
SELECT id_cambio, fecha, usuario, operacion, tabla, id_registro,
       campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios WHERE origen LIKE 'Directo en la BD%'
ORDER BY id_cambio DESC;


-- ════════════════════ 8. PRUEBAS EN VIVO ════════════════════

-- 8.1 INMUTABILIDAD: cada una debe dar ERROR "La auditoría no se puede modificar ni borrar"
DELETE FROM registro_cambio WHERE id_cambio = (SELECT min(id_cambio) FROM registro_cambio);

UPDATE registro_cambio SET usuario = 'otro' WHERE id_cambio = (SELECT min(id_cambio) FROM registro_cambio);

DELETE FROM registro_acceso WHERE id_acceso = (SELECT min(id_acceso) FROM registro_acceso);

TRUNCATE registro_cambio;

/* 8.2 EJECUTAR EN sgiv_db (sgiv_db → Query Tool). Copiar o seleccionar cada consulta de este bloque.

-- Triggers de auditoría instalados en cada tabla del sistema
SELECT event_object_table AS tabla, trigger_name,
       string_agg(event_manipulation, ', ') AS operaciones
FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_auditoria%'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Conexión con la BD de auditoría (postgres_fdw)
SELECT srvname AS servidor, srvoptions AS opciones FROM pg_foreign_server;

-- Cambio directo en la BD: subir 1 Bs el precio del producto 1
-- (luego ver la consulta 7.1 en sgiv_auditoria)
UPDATE producto SET precio_unitario = precio_unitario + 1 WHERE id_producto = 1;

-- Devolver el precio original (también queda registrado)
UPDATE producto SET precio_unitario = precio_unitario - 1 WHERE id_producto = 1;

*/
