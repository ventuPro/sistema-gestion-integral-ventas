-- ════════════════════════════════════════════════════════════════════
--  Consultas útiles de AUDITORÍA. Ejecutar conectado a la BD sgiv_auditoria
--  (pgAdmin → sgiv_auditoria → Query Tool).
--
--  Tablas:  registro_acceso (peticiones y sesiones), registro_cambio (triggers)
--  Vistas:  v_accesos, v_cambios, v_sesiones (fechas en hora de Bolivia)
-- ════════════════════════════════════════════════════════════════════

-- 1. Inicios y cierres de sesión, intentos fallidos y bloqueos
SELECT * FROM v_sesiones ORDER BY id_acceso DESC LIMIT 100;

-- 2. Todo lo que hizo un usuario en un día (peticiones + filas que modificó)
SELECT * FROM v_accesos
WHERE usuario ILIKE '%olivia@rickys.com%'
  AND fecha LIKE '2026-10-08%'
ORDER BY id_acceso;

-- 3. Historial completo de un registro (ej. el producto 5)
SELECT fecha, usuario, operacion, campos_modificados, datos_anteriores, datos_nuevos, origen
FROM v_cambios
WHERE tabla = 'producto' AND id_registro = '5'
ORDER BY id_cambio;

-- 4. Qué filas cambió una petición concreta (id_acceso de v_accesos)
SELECT tabla, operacion, id_registro, campos_modificados, datos_anteriores, datos_nuevos
FROM v_cambios WHERE id_acceso = 123 ORDER BY id_cambio;

-- 5. Cambios de precio de productos
SELECT fecha, usuario, id_registro AS id_producto,
       datos_anteriores ->> 'precio_unitario' AS precio_antes,
       datos_nuevos     ->> 'precio_unitario' AS precio_despues
FROM v_cambios
WHERE tabla = 'producto' AND 'precio_unitario' = ANY (campos_modificados)
ORDER BY id_cambio DESC;

-- 6. Accesos denegados (alguien intentó entrar a un módulo sin permiso)
SELECT * FROM v_accesos WHERE evento = 'ACCESO_DENEGADO' ORDER BY id_acceso DESC;

-- 7. Cambios hechos directamente en la BD (fuera del sistema)
SELECT * FROM v_cambios WHERE origen LIKE 'Directo en la BD%' ORDER BY id_cambio DESC;

-- 8. Cantidad de movimientos por usuario en el mes
SELECT COALESCE(usuario, 'Sin sesión') AS usuario, count(*) AS peticiones,
       count(*) FILTER (WHERE metodo <> 'GET') AS operaciones
FROM registro_acceso
WHERE fecha_hora >= date_trunc('month', now())
GROUP BY 1 ORDER BY 2 DESC;
