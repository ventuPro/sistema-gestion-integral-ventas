-- Archivo: database/schema.sql corregido

-- Limpieza previa para evitar errores de "ya existe" (Opcional pero recomendado en desarrollo)
DROP TABLE IF EXISTS detalle_venta CASCADE;
DROP TABLE IF EXISTS venta_caja CASCADE;
DROP TABLE IF EXISTS cliente CASCADE;
DROP TABLE IF EXISTS turno_caja CASCADE;
DROP TABLE IF EXISTS detalle_pedido CASCADE;
DROP TABLE IF EXISTS pedido_mesa CASCADE;
DROP TABLE IF EXISTS mesa_local CASCADE;
DROP TABLE IF EXISTS notificacion_admin CASCADE;
DROP TABLE IF EXISTS historial_inventario CASCADE;
DROP TABLE IF EXISTS inventario_sucursal CASCADE;
DROP TABLE IF EXISTS promocion CASCADE;
DROP TABLE IF EXISTS producto CASCADE;
DROP TABLE IF EXISTS categoria_producto CASCADE;
DROP TABLE IF EXISTS permiso_usuario CASCADE;
DROP TABLE IF EXISTS usuario CASCADE;
DROP TABLE IF EXISTS rol_usuario CASCADE;
DROP TABLE IF EXISTS sucursal CASCADE;

-- ==========================================
-- 1. CONFIGURACIÓN DE SUCURSALES Y USUARIOS
-- ==========================================

CREATE TABLE sucursal (
    id_sucursal SERIAL PRIMARY KEY,
    nombre_sucursal VARCHAR(100) NOT NULL,
    direccion_fisica TEXT,
    telefono_contacto VARCHAR(15)
);

CREATE TABLE rol_usuario (
    id_rol SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL,
    nivel_permiso INT NOT NULL 
);

CREATE TABLE usuario (
    id_usuario SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_rol INT REFERENCES rol_usuario(id_rol),
    nombre_completo VARCHAR(100) NOT NULL,
    correo_electronico VARCHAR(100) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(255) NOT NULL,
    estado_activo BOOLEAN DEFAULT TRUE,
    -- Flag sincronizado automáticamente con turno_caja.estado_turno.
    -- TRUE  → el cajero tiene un turno abierto y puede operar.
    -- FALSE → no tiene turno abierto (sin apertura del día o cerrado).
    caja_habilitada BOOLEAN DEFAULT FALSE
);

-- Permisos granulares por usuario (sobreescriben los defaults del rol).
-- El admin asigna/quita acceso a módulos específicos para cada cajero.
CREATE TABLE permiso_usuario (
    id_permiso SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    modulo     VARCHAR(50) NOT NULL,
    tiene_acceso BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_usuario, modulo)
);
CREATE INDEX idx_permiso_usuario_id ON permiso_usuario (id_usuario);

-- ==========================================
-- 2. CATÁLOGO DE PRODUCTOS Y PROMOCIONES
-- ==========================================

CREATE TABLE categoria_producto (
    id_categoria SERIAL PRIMARY KEY,
    nombre_categoria VARCHAR(50) NOT NULL,
    descripcion_categoria TEXT
);

CREATE TABLE producto (
    id_producto SERIAL PRIMARY KEY,
    id_categoria INT REFERENCES categoria_producto(id_categoria),
    nombre_producto VARCHAR(100) NOT NULL,
    descripcion_producto TEXT,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    url_imagen TEXT,
    mostrar_en_menu BOOLEAN DEFAULT TRUE,
    estado_activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE promocion (
    id_promocion SERIAL PRIMARY KEY,
    id_producto INT REFERENCES producto(id_producto),
    precio_promocional DECIMAL(10, 2) NOT NULL,
    fecha_inicio TIMESTAMP NOT NULL,
    fecha_fin TIMESTAMP NOT NULL,
    estado_activo BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- 3. GESTIÓN DE INVENTARIO Y ALERTAS
-- ==========================================

CREATE TABLE inventario_sucursal (
    id_inventario SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_producto INT REFERENCES producto(id_producto),
    cantidad_actual INT NOT NULL DEFAULT 0,
    stock_minimo_alerta INT NOT NULL DEFAULT 10,
    UNIQUE(id_sucursal, id_producto)
);

CREATE TABLE historial_inventario (
    id_historial SERIAL PRIMARY KEY,
    id_inventario INT REFERENCES inventario_sucursal(id_inventario),
    id_usuario INT REFERENCES usuario(id_usuario),
    tipo_movimiento VARCHAR(20) NOT NULL,
    cantidad_movida INT NOT NULL,
    motivo_movimiento VARCHAR(100),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notificacion_admin (
    id_notificacion SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    tipo_alerta VARCHAR(50) NOT NULL,
    mensaje_alerta TEXT NOT NULL,
    estado_leido BOOLEAN DEFAULT FALSE,
    fecha_notificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. MENÚ DIGITAL INTERACTIVO (CLIENTE)
-- ==========================================

CREATE TABLE mesa_local (
    id_mesa SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    numero_mesa INT NOT NULL,
    codigo_qr TEXT UNIQUE,
    estado_mesa VARCHAR(20) DEFAULT 'Libre'
);

CREATE TABLE pedido_mesa (
    id_pedido SERIAL PRIMARY KEY,
    id_mesa INT REFERENCES mesa_local(id_mesa),
    estado_pedido VARCHAR(30) DEFAULT 'Pendiente',
    monto_total DECIMAL(10, 2) DEFAULT 0.00,
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detalle_pedido (
    id_detalle_pedido SERIAL PRIMARY KEY,
    id_pedido INT REFERENCES pedido_mesa(id_pedido),
    id_producto INT REFERENCES producto(id_producto),
    cantidad_solicitada INT NOT NULL,
    precio_aplicado DECIMAL(10, 2) NOT NULL,
    subtotal_detalle DECIMAL(10, 2) NOT NULL,
    nota_cliente TEXT
);

-- ==========================================
-- 5. CONTROL DE CAJA Y TURNOS
-- ==========================================

CREATE TABLE turno_caja (
    id_turno SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_usuario_cajero INT REFERENCES usuario(id_usuario),
    fecha_hora_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_hora_cierre TIMESTAMP,
    monto_inicial DECIMAL(10, 2) NOT NULL,
    monto_calculado DECIMAL(10, 2),
    monto_real_declarado DECIMAL(10, 2),
    diferencia DECIMAL(10, 2),
    estado_turno VARCHAR(20) DEFAULT 'Abierto'
);

-- ==========================================
-- 6. SISTEMA DE VENTAS (CAJA / EMPLEADOS)
-- ==========================================

CREATE TABLE cliente (
    id_cliente SERIAL PRIMARY KEY,
    nombre_cliente VARCHAR(100) NOT NULL,
    numero_documento VARCHAR(20)
);

CREATE TABLE venta_caja (
    id_venta SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_usuario_cajero INT REFERENCES usuario(id_usuario),
    id_cliente INT REFERENCES cliente(id_cliente),
    id_pedido_mesa INT REFERENCES pedido_mesa(id_pedido) NULL,
    id_turno INT REFERENCES turno_caja(id_turno),
    monto_total_venta DECIMAL(10, 2) NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL,
    fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detalle_venta (
    id_detalle_venta SERIAL PRIMARY KEY,
    id_venta INT REFERENCES venta_caja(id_venta),
    id_producto INT REFERENCES producto(id_producto),
    cantidad_vendida INT NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    subtotal_venta DECIMAL(10, 2) NOT NULL
);