-- Archivo: database/schema.sql corregido
--
-- AUDITORÍA: la BD sgiv_auditoria, el esquema 'auditoria' y los triggers de
-- todas las tablas los crea el backend al iniciar (backend-sgiv/src/auditoria).
-- Consultas de ejemplo: database/consultas_auditoria.sql

-- Limpieza previa para evitar errores de "ya existe" (Opcional pero recomendado en desarrollo)
DROP TABLE IF EXISTS configuracion CASCADE;
DROP TABLE IF EXISTS propietario CASCADE;
DROP TABLE IF EXISTS horario_sucursal CASCADE;
DROP TABLE IF EXISTS detalle_cuenta CASCADE;
DROP TABLE IF EXISTS cuenta_mesa CASCADE;
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
    telefono_contacto VARCHAR(15),
    estado_activo BOOLEAN NOT NULL DEFAULT TRUE
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

-- codigo_qr: token aleatorio que va en la URL del menú (/menu/<codigo_qr>)
CREATE TABLE mesa_local (
    id_mesa SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    numero_mesa INT NOT NULL,
    codigo_qr TEXT UNIQUE NOT NULL,
    estado_mesa VARCHAR(20) DEFAULT 'Libre'
);

-- Comanda / cuenta abierta de una mesa (atención directa del cajero + pedidos QR)
CREATE TABLE cuenta_mesa (
    id_cuenta SERIAL PRIMARY KEY,
    id_mesa INT REFERENCES mesa_local(id_mesa) ON DELETE CASCADE,
    id_usuario_apertura INT REFERENCES usuario(id_usuario),
    estado VARCHAR(20) DEFAULT 'Abierta',
    total_acumulado DECIMAL(10, 2) DEFAULT 0.00,
    metodo_pago VARCHAR(50),
    fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP
);

-- Pedidos hechos por el cliente (menú QR en mesa; preparado para delivery).
-- Flujo: Pendiente_Cajero → Confirmado → Entregado → Pagado (o Cancelado).
-- El stock se reserva al crear el pedido y se devuelve si se cancela.
-- Al confirmarse, sus productos pasan a la cuenta de la mesa (id_cuenta).
CREATE TABLE pedido_mesa (
    id_pedido SERIAL PRIMARY KEY,
    tipo_pedido VARCHAR(20) NOT NULL DEFAULT 'Mesa',
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_mesa INT REFERENCES mesa_local(id_mesa) ON DELETE CASCADE,
    id_cuenta INT REFERENCES cuenta_mesa(id_cuenta) ON DELETE SET NULL,
    id_usuario_atencion INT REFERENCES usuario(id_usuario),
    estado_pedido VARCHAR(30) NOT NULL DEFAULT 'Pendiente_Cajero',
    monto_total DECIMAL(10, 2) DEFAULT 0.00,
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observacion_general TEXT,
    fecha_aprobacion TIMESTAMP,
    fecha_entrega TIMESTAMP,
    -- Datos de contacto (pedidos a delivery)
    nombre_cliente VARCHAR(100),
    telefono_cliente VARCHAR(20),
    direccion_entrega TEXT,
    CONSTRAINT pedido_mesa_estado_check
        CHECK (estado_pedido IN ('Pendiente_Cajero', 'Confirmado', 'Entregado', 'Pagado', 'Cancelado')),
    CONSTRAINT pedido_mesa_tipo_check
        CHECK (tipo_pedido IN ('Mesa', 'Delivery') AND (tipo_pedido <> 'Mesa' OR id_mesa IS NOT NULL))
);

CREATE TABLE detalle_pedido (
    id_detalle_pedido SERIAL PRIMARY KEY,
    id_pedido INT REFERENCES pedido_mesa(id_pedido) ON DELETE CASCADE,
    id_producto INT REFERENCES producto(id_producto),
    cantidad_solicitada INT NOT NULL,
    precio_aplicado DECIMAL(10, 2) NOT NULL,
    subtotal_detalle DECIMAL(10, 2) NOT NULL,
    nota_cliente TEXT
);

CREATE TABLE detalle_cuenta (
    id_detalle_cuenta SERIAL PRIMARY KEY,
    id_cuenta INT REFERENCES cuenta_mesa(id_cuenta) ON DELETE CASCADE,
    id_producto INT REFERENCES producto(id_producto),
    cantidad INT NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    nota TEXT,
    origen VARCHAR(20) DEFAULT 'cajero',
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    id_pedido_mesa INT REFERENCES pedido_mesa(id_pedido) ON DELETE SET NULL,
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

-- ==========================================
-- 6b. CONFIGURACIÓN DEL NEGOCIO (módulo Ajustes)
-- ==========================================
-- Una sola fila (id 1). Los valores por defecto son los del sistema original;
-- colores en NULL = colores originales. El backend también crea estas tablas al
-- iniciar en una BD existente (backend-sgiv/src/config/migraciones.js).
CREATE TABLE configuracion (
    id_configuracion    INT PRIMARY KEY DEFAULT 1 CHECK (id_configuracion = 1),
    nombre_comercial    VARCHAR(100) NOT NULL DEFAULT 'Pastelería Ricky''s',
    razon_social        VARCHAR(150),
    nit                 VARCHAR(20),
    rubro               VARCHAR(60) DEFAULT 'Pastelería',
    eslogan             VARCHAR(150),
    telefono            VARCHAR(20),
    whatsapp            VARCHAR(20),
    correo              VARCHAR(100),
    sitio_web           VARCHAR(150),
    direccion           TEXT,
    ciudad              VARCHAR(60) DEFAULT 'La Paz',
    pais                VARCHAR(60) DEFAULT 'Bolivia',
    facebook            VARCHAR(150),
    instagram           VARCHAR(150),
    tiktok              VARCHAR(150),
    url_logo            TEXT,
    url_favicon         TEXT,
    color_primario      VARCHAR(7),
    color_secundario    VARCHAR(7),
    tema                VARCHAR(10) NOT NULL DEFAULT 'claro' CHECK (tema IN ('claro', 'oscuro', 'auto')),
    -- Parámetros: ventas y comprobantes
    moneda_simbolo      VARCHAR(5)   NOT NULL DEFAULT 'Bs.',
    pago_efectivo       BOOLEAN      NOT NULL DEFAULT TRUE,
    pago_qr             BOOLEAN      NOT NULL DEFAULT TRUE,
    url_qr_cobro        TEXT,
    ticket_mensaje_pie  VARCHAR(150) NOT NULL DEFAULT '¡Gracias por su compra!',
    -- Parámetros: menú QR
    menu_activo              BOOLEAN NOT NULL DEFAULT TRUE,
    menu_mensaje_bienvenida  VARCHAR(200),
    menu_minutos_expiracion  INT NOT NULL DEFAULT 15 CHECK (menu_minutos_expiracion BETWEEN 5 AND 120),
    menu_max_pendientes_mesa INT NOT NULL DEFAULT 3  CHECK (menu_max_pendientes_mesa BETWEEN 1 AND 10),
    menu_max_pedidos_ip      INT NOT NULL DEFAULT 10 CHECK (menu_max_pedidos_ip BETWEEN 1 AND 100),
    -- Parámetros: inventario
    stock_minimo_defecto     INT NOT NULL DEFAULT 5  CHECK (stock_minimo_defecto BETWEEN 0 AND 10000),
    -- Parámetros: seguridad
    captcha_activo           BOOLEAN NOT NULL DEFAULT TRUE,
    login_max_intentos       INT NOT NULL DEFAULT 5  CHECK (login_max_intentos BETWEEN 3 AND 20),
    login_minutos_bloqueo    INT NOT NULL DEFAULT 15 CHECK (login_minutos_bloqueo BETWEEN 1 AND 1440),
    sesion_horas             INT NOT NULL DEFAULT 8  CHECK (sesion_horas BETWEEN 1 AND 24),
    CONSTRAINT configuracion_metodo_pago_check CHECK (pago_efectivo OR pago_qr),
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Horario de atención por sucursal (1 = lunes … 7 = domingo)
CREATE TABLE horario_sucursal (
    id_sucursal   INT NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE CASCADE,
    dia_semana    SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    abierto       BOOLEAN NOT NULL DEFAULT TRUE,
    hora_apertura TIME,
    hora_cierre   TIME,
    PRIMARY KEY (id_sucursal, dia_semana),
    CHECK (NOT abierto OR (hora_apertura IS NOT NULL AND hora_cierre IS NOT NULL AND hora_apertura <> hora_cierre))
);

-- Propietarios del negocio (datos privados: solo el administrador)
CREATE TABLE propietario (
    id_propietario   SERIAL PRIMARY KEY,
    nombre_completo  VARCHAR(100) NOT NULL,
    ci               VARCHAR(20) UNIQUE,
    cargo            VARCHAR(60),
    telefono         VARCHAR(20),
    correo           VARCHAR(100),
    porcentaje_participacion NUMERIC(5, 2) NOT NULL DEFAULT 0
        CHECK (porcentaje_participacion BETWEEN 0 AND 100),
    fecha_registro   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 7. ÍNDICES
-- ==========================================

CREATE INDEX idx_turno_cajero_estado      ON turno_caja (id_usuario_cajero, estado_turno);
CREATE INDEX idx_venta_caja_cajero_fecha  ON venta_caja (id_usuario_cajero, fecha_venta);
CREATE INDEX idx_cuenta_mesa_estado       ON cuenta_mesa (id_mesa, estado);
CREATE UNIQUE INDEX uq_cuenta_abierta_mesa ON cuenta_mesa (id_mesa) WHERE estado = 'Abierta';
CREATE INDEX idx_pedido_sucursal_estado   ON pedido_mesa (id_sucursal, estado_pedido);
CREATE INDEX idx_pedido_mesa_estado       ON pedido_mesa (id_mesa, estado_pedido);
CREATE INDEX idx_pedido_cuenta            ON pedido_mesa (id_cuenta);
