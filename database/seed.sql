-- Roles del sistema
INSERT INTO rol_usuario (id_rol, nombre_rol, nivel_permiso) VALUES
(1, 'Administrador', 1),
(2, 'Cajero',        2),
(3, 'Cocina',        3)
ON CONFLICT (id_rol) DO UPDATE
  SET nombre_rol = EXCLUDED.nombre_rol,
      nivel_permiso = EXCLUDED.nivel_permiso;

-- Sucursal inicial
INSERT INTO sucursal (nombre_sucursal, direccion_fisica, telefono_contacto)
VALUES ('Casa Matriz', 'La Paz, Bolivia', '70000000')
ON CONFLICT DO NOTHING;

-- Usuario administrador por defecto
-- Contraseña: Admin123 (el hash es generado con bcrypt salt=10)
INSERT INTO usuario (id_sucursal, id_rol, nombre_completo, correo_electronico, contrasena_hash, estado_activo)
VALUES (
  1, 1,
  'Administrador General',
  'admin@rickys.com',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  TRUE
)
ON CONFLICT (correo_electronico) DO NOTHING;