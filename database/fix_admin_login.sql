-- ════════════════════════════════════════════════════════════════════
--  FIX LOGIN — restaura el usuario admin@sgiv.com / secreta123
--
--  Ejecutar:
--    psql -U <usuario> -d sgiv_db -f database/fix_admin_login.sql
-- ════════════════════════════════════════════════════════════════════

-- 1. DIAGNÓSTICO: ver qué usuarios existen
SELECT id_usuario, nombre_completo, correo_electronico, estado_activo,
       (contrasena_hash IS NOT NULL) AS tiene_hash,
       id_rol, id_sucursal
FROM usuario
ORDER BY id_usuario;

-- 2. Asegurar que exista al menos una sucursal
INSERT INTO sucursal (nombre_sucursal, direccion_fisica, telefono_contacto)
SELECT 'Sucursal 1', 'La Paz, Bolivia', ''
WHERE NOT EXISTS (SELECT 1 FROM sucursal);

-- 3. Asegurar que exista el rol Administrador
INSERT INTO rol_usuario (id_rol, nombre_rol, nivel_permiso)
VALUES (1, 'Administrador', 1)
ON CONFLICT (id_rol) DO NOTHING;

-- 4. Crear o actualizar admin@sgiv.com con la contraseña "secreta123"
INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash, estado_activo, caja_habilitada)
VALUES (
    (SELECT id_sucursal FROM sucursal ORDER BY id_sucursal LIMIT 1),
    1,
    'Administrador',
    'admin@sgiv.com',
    '$2b$10$Vyh4QGlRV0AQKsc8QMTa0uEMehtB6z0wQinjw035oNY0P4KW4738u',
    TRUE,
    FALSE
)
ON CONFLICT (correo_electronico) DO UPDATE
   SET contrasena_hash = EXCLUDED.contrasena_hash,
       estado_activo   = TRUE,
       id_rol          = 1;

-- 5. Verificación final
SELECT id_usuario, nombre_completo, correo_electronico, estado_activo, id_rol
FROM usuario
WHERE correo_electronico = 'admin@sgiv.com';
