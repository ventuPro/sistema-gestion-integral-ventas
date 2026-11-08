-- Archivo: database/schema.sql corregido
--
-- AUDITORÍA: la BD sgiv_auditoria, el esquema 'auditoria' y los triggers de
-- todas las tablas los crea el backend al iniciar (backend-sgiv/src/auditoria).
-- Consultas de ejemplo: database/consultas_auditoria.sql

-- Limpieza previa para evitar errores de "ya existe" (Opcional pero recomendado en desarrollo)
DROP TABLE IF EXISTS historial_inversion_receta CASCADE;
DROP TABLE IF EXISTS ingrediente_receta CASCADE;
DROP TABLE IF EXISTS receta CASCADE;
DROP TABLE IF EXISTS historial_precio_insumo CASCADE;
DROP TABLE IF EXISTS insumo CASCADE;
DROP TABLE IF EXISTS unidad_medida CASCADE;
DROP TABLE IF EXISTS configuracion CASCADE;
DROP TABLE IF EXISTS propietario CASCADE;
DROP TABLE IF EXISTS horario_sucursal CASCADE;
DROP TABLE IF EXISTS detalle_cuenta CASCADE;
DROP TABLE IF EXISTS cuenta_mesa CASCADE;
DROP TABLE IF EXISTS detalle_venta CASCADE;
DROP TABLE IF EXISTS venta_caja CASCADE;
DROP TABLE IF EXISTS turno_caja CASCADE;
DROP TABLE IF EXISTS detalle_transferencia CASCADE;
DROP TABLE IF EXISTS transferencia CASCADE;
DROP TABLE IF EXISTS bloqueo_menu CASCADE;
DROP TABLE IF EXISTS detalle_pedido CASCADE;
DROP TABLE IF EXISTS pedido_mesa CASCADE;
DROP TABLE IF EXISTS mesa_local CASCADE;
DROP TABLE IF EXISTS historial_inventario CASCADE;
DROP TABLE IF EXISTS inventario_sucursal CASCADE;
DROP TABLE IF EXISTS promocion_dia CASCADE;
DROP TABLE IF EXISTS promocion_categoria CASCADE;
DROP TABLE IF EXISTS promocion_producto CASCADE;
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
    nombre_rol VARCHAR(50) NOT NULL
);

CREATE TABLE usuario (
    id_usuario SERIAL PRIMARY KEY,
    id_sucursal INT REFERENCES sucursal(id_sucursal),
    id_rol INT REFERENCES rol_usuario(id_rol),
    nombre_completo VARCHAR(100) NOT NULL,
    correo_electronico VARCHAR(100) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(255) NOT NULL,
    estado_activo BOOLEAN DEFAULT TRUE,
    -- «Caja habilitada» no se guarda: es tener un turno abierto en turno_caja
    -- Telegram: el teléfono es la llave para vincular (la persona comparte su número con el bot);
    -- recibe avisos de avisos_sucursal (NULL = todas) y el código de cada inicio de sesión
    telefono VARCHAR(20),
    telegram_chat_id BIGINT,
    avisos_telegram BOOLEAN NOT NULL DEFAULT TRUE,
    avisos_sucursal INT REFERENCES sucursal(id_sucursal) ON DELETE SET NULL
);
CREATE UNIQUE INDEX uq_usuario_telefono ON usuario (telefono) WHERE telefono IS NOT NULL;
CREATE UNIQUE INDEX uq_usuario_telegram ON usuario (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

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
    descripcion_categoria TEXT,
    orden SMALLINT NOT NULL DEFAULT 0          -- orden en el menú QR (lo define el admin)
);

CREATE TABLE producto (
    id_producto SERIAL PRIMARY KEY,
    id_categoria INT REFERENCES categoria_producto(id_categoria),
    nombre_producto VARCHAR(100) NOT NULL,
    descripcion_producto TEXT,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    url_imagen TEXT,
    mostrar_en_menu BOOLEAN DEFAULT TRUE,
    estado_activo BOOLEAN DEFAULT TRUE,
    ingredientes TEXT,                         -- reverso de la tarjeta en el menú QR
    preparacion TEXT,
    destacado BOOLEAN NOT NULL DEFAULT FALSE   -- «Recomendados de la casa»
);

-- Promociones: se aplican solas al cobrar y siempre gana la que más ahorra al cliente
-- tipo: PORCENTAJE (valor = %), PRECIO (valor = precio especial por unidad),
--       NXM (lleva/paga, ej. 3x2), COMBO (valor = precio del combo; productos con cantidad)
CREATE TABLE promocion (
    id_promocion  SERIAL PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL,
    tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('PORCENTAJE', 'PRECIO', 'NXM', 'COMBO')),
    valor         DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
    lleva         SMALLINT CHECK (lleva BETWEEN 2 AND 20),
    paga          SMALLINT CHECK (paga >= 1),
    id_sucursal   INT REFERENCES sucursal(id_sucursal),
    fecha_inicio  DATE NOT NULL,
    fecha_fin     DATE NOT NULL,
    hora_inicio   TIME,
    hora_fin      TIME,
    estado_activo BOOLEAN NOT NULL DEFAULT TRUE,
    id_usuario_creador INT REFERENCES usuario(id_usuario),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (fecha_inicio <= fecha_fin),
    CHECK ((hora_inicio IS NULL) = (hora_fin IS NULL)),
    CHECK (tipo <> 'NXM' OR (lleva IS NOT NULL AND paga IS NOT NULL AND paga < lleva))
);

CREATE TABLE promocion_producto (
    id_promocion INT NOT NULL REFERENCES promocion(id_promocion) ON DELETE CASCADE,
    id_producto  INT NOT NULL REFERENCES producto(id_producto),
    cantidad     SMALLINT NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 50),
    PRIMARY KEY (id_promocion, id_producto)
);

CREATE TABLE promocion_categoria (
    id_promocion INT NOT NULL REFERENCES promocion(id_promocion) ON DELETE CASCADE,
    id_categoria INT NOT NULL REFERENCES categoria_producto(id_categoria),
    PRIMARY KEY (id_promocion, id_categoria)
);

-- Días de la semana en que vale (ISO: 1 = lunes … 7 = domingo); sin filas = todos los días
CREATE TABLE promocion_dia (
    id_promocion INT NOT NULL REFERENCES promocion(id_promocion) ON DELETE CASCADE,
    dia          SMALLINT NOT NULL CONSTRAINT promocion_dia_check CHECK (dia BETWEEN 1 AND 7),
    PRIMARY KEY (id_promocion, dia)
);

-- ==========================================
-- 3. GESTIÓN DE INVENTARIO Y ALERTAS
-- ==========================================

CREATE TABLE inventario_sucursal (
    id_inventario SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursal(id_sucursal),
    id_producto INT NOT NULL REFERENCES producto(id_producto),
    -- El stock mínimo de alerta es uno solo: configuracion.stock_minimo_defecto
    cantidad_actual INT NOT NULL DEFAULT 0,
    UNIQUE(id_sucursal, id_producto),
    CONSTRAINT inventario_sucursal_cantidad_no_negativa CHECK (cantidad_actual >= 0)
);

CREATE TABLE historial_inventario (
    id_historial SERIAL PRIMARY KEY,
    id_inventario INT NOT NULL REFERENCES inventario_sucursal(id_inventario),
    id_usuario INT REFERENCES usuario(id_usuario),
    tipo_movimiento VARCHAR(20) NOT NULL CONSTRAINT historial_inventario_tipo_check CHECK (tipo_movimiento IN ('INGRESO', 'SALIDA')),
    cantidad_movida INT NOT NULL,
    motivo_movimiento VARCHAR(100),
    detalle VARCHAR(200),
    stock_resultante INT,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transferencias directas de productos entre sucursales (no se editan ni se borran)
CREATE TABLE transferencia (
    id_transferencia    SERIAL PRIMARY KEY,
    id_sucursal_origen  INT NOT NULL REFERENCES sucursal(id_sucursal),
    id_sucursal_destino INT NOT NULL REFERENCES sucursal(id_sucursal),
    id_usuario          INT REFERENCES usuario(id_usuario),
    observacion         VARCHAR(200),
    fecha_transferencia TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (id_sucursal_origen <> id_sucursal_destino)
);
CREATE TABLE detalle_transferencia (
    id_transferencia INT NOT NULL REFERENCES transferencia(id_transferencia),
    id_producto      INT NOT NULL REFERENCES producto(id_producto),
    cantidad         INT NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (id_transferencia, id_producto)
);

-- ==========================================
-- 4. MENÚ DIGITAL INTERACTIVO (CLIENTE)
-- ==========================================

-- codigo_qr: token aleatorio que va en la URL del menú (/menu/<codigo_qr>)
CREATE TABLE mesa_local (
    id_mesa SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursal(id_sucursal),
    numero_mesa INT NOT NULL,
    codigo_qr TEXT UNIQUE NOT NULL,
    -- Libre / Ocupada (= habilitada: sus celulares piden sin verificación)
    estado_mesa VARCHAR(20) NOT NULL DEFAULT 'Libre' CONSTRAINT mesa_local_estado_check CHECK (estado_mesa IN ('Libre', 'Ocupada')),
    fecha_habilitacion TIMESTAMPTZ,
    -- Las visitas del menú QR que empezaron antes de esta fecha terminaron
    fecha_liberacion TIMESTAMPTZ,
    -- Código del QR temporal impreso (cambia en cada habilitación)
    codigo_visita VARCHAR(32)
);

-- Comanda / cuenta abierta de una mesa (atención directa del cajero + pedidos QR)
CREATE TABLE cuenta_mesa (
    id_cuenta SERIAL PRIMARY KEY,
    id_mesa INT NOT NULL REFERENCES mesa_local(id_mesa) ON DELETE CASCADE,
    id_usuario_apertura INT REFERENCES usuario(id_usuario),
    -- Lo que falta cobrar se calcula del detalle (detalle_cuenta.id_venta IS NULL);
    -- el método de pago está en cada venta (cobro por persona)
    estado VARCHAR(20) NOT NULL DEFAULT 'Abierta' CONSTRAINT cuenta_mesa_estado_check CHECK (estado IN ('Abierta', 'Pagada', 'Cancelada')),
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
    -- El monto del pedido es la suma de detalle_pedido
    estado_pedido VARCHAR(30) NOT NULL DEFAULT 'Pendiente_Cajero',
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observacion_general TEXT,
    fecha_aprobacion TIMESTAMP,
    fecha_entrega TIMESTAMP,
    -- Datos de contacto (pedidos a delivery)
    nombre_cliente VARCHAR(100),
    telefono_cliente VARCHAR(20),
    direccion_entrega TEXT,
    -- Código del celular que hizo el pedido (menú QR): consumo y cobro por persona
    cliente_mesa VARCHAR(32),
    -- Pedido hecho con la mesa libre: el cajero lo verifica
    sin_verificar BOOLEAN NOT NULL DEFAULT FALSE,
    ip_cliente VARCHAR(45),
    CONSTRAINT pedido_mesa_estado_check
        CHECK (estado_pedido IN ('Pendiente_Cajero', 'Confirmado', 'Entregado', 'Pagado', 'Cancelado')),
    CONSTRAINT pedido_mesa_tipo_check
        CHECK (tipo_pedido IN ('Mesa', 'Delivery') AND (tipo_pedido <> 'Mesa' OR id_mesa IS NOT NULL))
);

-- Celular/IP que no puede pedir en una mesa (pedido rechazado como falso)
CREATE TABLE bloqueo_menu (
    id_bloqueo   SERIAL PRIMARY KEY,
    id_mesa      INT NOT NULL REFERENCES mesa_local(id_mesa) ON DELETE CASCADE,
    cliente_mesa VARCHAR(32),
    ip_cliente   VARCHAR(45),
    id_pedido    INT REFERENCES pedido_mesa(id_pedido) ON DELETE SET NULL,
    id_usuario   INT REFERENCES usuario(id_usuario),
    fecha_bloqueo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bloqueado_hasta TIMESTAMPTZ NOT NULL
);

CREATE TABLE detalle_pedido (
    id_detalle_pedido SERIAL PRIMARY KEY,
    id_pedido INT NOT NULL REFERENCES pedido_mesa(id_pedido) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES producto(id_producto),
    cantidad_solicitada INT NOT NULL,
    precio_aplicado DECIMAL(10, 2) NOT NULL,
    nota_cliente TEXT,
    subtotal_detalle NUMERIC(10, 2) GENERATED ALWAYS AS (cantidad_solicitada * precio_aplicado) STORED
);

CREATE TABLE detalle_cuenta (
    id_detalle_cuenta SERIAL PRIMARY KEY,
    id_cuenta INT NOT NULL REFERENCES cuenta_mesa(id_cuenta) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES producto(id_producto),
    cantidad INT NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    subtotal NUMERIC(10, 2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    nota TEXT,
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Pedido QR del que viene (NULL = cargado por el cajero): de ahí salen el celular y el nombre del cliente
    id_pedido INT REFERENCES pedido_mesa(id_pedido),
    -- Cobro por separado: venta en la que ya se pagó (NULL = por cobrar; FK más abajo)
    id_venta INT
);

-- ==========================================
-- 5. CONTROL DE CAJA Y TURNOS
-- ==========================================

CREATE TABLE turno_caja (
    id_turno SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursal(id_sucursal),
    id_usuario_cajero INT NOT NULL REFERENCES usuario(id_usuario),
    fecha_hora_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_hora_cierre TIMESTAMP,
    monto_inicial DECIMAL(10, 2) NOT NULL,
    monto_calculado DECIMAL(10, 2),
    monto_real_declarado DECIMAL(10, 2),
    diferencia NUMERIC(10, 2) GENERATED ALWAYS AS (monto_real_declarado - monto_calculado) STORED,
    estado_turno VARCHAR(20) NOT NULL DEFAULT 'Abierto' CONSTRAINT turno_caja_estado_check CHECK (estado_turno IN ('Abierto', 'Cerrado')),
    -- Cajero, Administrador o Sistema (cierre automático a las 00:00)
    cerrado_por VARCHAR(15) CHECK (cerrado_por IN ('Cajero', 'Administrador', 'Sistema'))
);

-- ==========================================
-- 6. SISTEMA DE VENTAS (CAJA / EMPLEADOS)
-- ==========================================

CREATE TABLE venta_caja (
    id_venta SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL REFERENCES sucursal(id_sucursal),
    id_usuario_cajero INT NOT NULL REFERENCES usuario(id_usuario),
    id_turno INT NOT NULL REFERENCES turno_caja(id_turno),
    monto_total_venta DECIMAL(10, 2) NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL CONSTRAINT venta_caja_metodo_pago_check CHECK (metodo_pago IN ('Efectivo', 'QR')),
    fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Descuentos ya restados de monto_total_venta
    descuento_promociones DECIMAL(10, 2) NOT NULL DEFAULT 0,
    descuento_manual      DECIMAL(10, 2) NOT NULL DEFAULT 0,
    motivo_descuento      VARCHAR(120)
);

CREATE TABLE detalle_venta (
    id_detalle_venta SERIAL PRIMARY KEY,
    id_venta INT NOT NULL REFERENCES venta_caja(id_venta),
    id_producto INT NOT NULL REFERENCES producto(id_producto),
    cantidad_vendida INT NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    subtotal_venta DECIMAL(10, 2) NOT NULL,
    -- precio_unitario = precio de lista; subtotal_venta = lo cobrado tras los descuentos
    descuento_promocion DECIMAL(10, 2) NOT NULL DEFAULT 0,
    descuento_manual    DECIMAL(10, 2) NOT NULL DEFAULT 0,
    id_promocion        INT REFERENCES promocion(id_promocion)
);

ALTER TABLE detalle_cuenta
    ADD CONSTRAINT detalle_cuenta_id_venta_fkey FOREIGN KEY (id_venta) REFERENCES venta_caja(id_venta);

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
    login_titulo        VARCHAR(100),
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
    ticket_ancho        VARCHAR(3)   NOT NULL DEFAULT '80' CHECK (ticket_ancho IN ('58', '80', 'A4')),
    -- Parámetros: menú QR
    menu_activo              BOOLEAN NOT NULL DEFAULT TRUE,
    menu_mensaje_bienvenida  VARCHAR(200),
    menu_minutos_expiracion  INT NOT NULL DEFAULT 15 CHECK (menu_minutos_expiracion BETWEEN 5 AND 120),
    menu_max_pendientes_mesa INT NOT NULL DEFAULT 3  CHECK (menu_max_pendientes_mesa BETWEEN 1 AND 10),
    menu_max_pedidos_ip      INT NOT NULL DEFAULT 10 CHECK (menu_max_pedidos_ip BETWEEN 1 AND 100),
    menu_visita_horas        INT NOT NULL DEFAULT 3  CHECK (menu_visita_horas BETWEEN 1 AND 12),
    menu_visita_inactividad  INT NOT NULL DEFAULT 30 CHECK (menu_visita_inactividad BETWEEN 10 AND 240),
    menu_bloqueo_horas       INT NOT NULL DEFAULT 6  CHECK (menu_bloqueo_horas BETWEEN 1 AND 72),
    menu_qr_visita           BOOLEAN NOT NULL DEFAULT FALSE,
    -- Parámetros: inventario
    stock_minimo_defecto     INT NOT NULL DEFAULT 5  CHECK (stock_minimo_defecto BETWEEN 0 AND 10000),
    -- Parámetros: seguridad
    captcha_activo           BOOLEAN NOT NULL DEFAULT TRUE,
    login_max_intentos       INT NOT NULL DEFAULT 5  CHECK (login_max_intentos BETWEEN 3 AND 20),
    login_minutos_bloqueo    INT NOT NULL DEFAULT 15 CHECK (login_minutos_bloqueo BETWEEN 1 AND 1440),
    sesion_horas             INT NOT NULL DEFAULT 8  CHECK (sesion_horas BETWEEN 1 AND 24),
    -- Inteligencia artificial (Groq)
    ia_info_negocio     VARCHAR(3000),
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
-- Un solo turno abierto por cajero (abrir caja dos veces a la vez)
CREATE UNIQUE INDEX uq_turno_abierto_cajero ON turno_caja (id_usuario_cajero) WHERE estado_turno = 'Abierto';
CREATE INDEX idx_pedido_sucursal_estado   ON pedido_mesa (id_sucursal, estado_pedido);
CREATE INDEX idx_pedido_mesa_estado       ON pedido_mesa (id_mesa, estado_pedido);
CREATE INDEX idx_pedido_cuenta            ON pedido_mesa (id_cuenta);
CREATE INDEX idx_mesa_sucursal_numero     ON mesa_local (id_sucursal, numero_mesa);
CREATE INDEX idx_mesa_estado_habilitacion ON mesa_local (estado_mesa, fecha_habilitacion);
CREATE INDEX idx_bloqueo_menu_mesa        ON bloqueo_menu (id_mesa, bloqueado_hasta);
CREATE INDEX idx_turno_estado_apertura     ON turno_caja (estado_turno, fecha_hora_apertura);
CREATE INDEX idx_transferencia_origen_fecha  ON transferencia (id_sucursal_origen, fecha_transferencia);
CREATE INDEX idx_transferencia_destino_fecha ON transferencia (id_sucursal_destino, fecha_transferencia);
CREATE INDEX idx_venta_caja_sucursal_fecha ON venta_caja (id_sucursal, fecha_venta);
CREATE INDEX idx_venta_caja_turno         ON venta_caja (id_turno);
CREATE INDEX idx_detalle_venta_venta      ON detalle_venta (id_venta);
CREATE INDEX idx_detalle_venta_producto   ON detalle_venta (id_producto);
CREATE INDEX idx_detalle_cuenta_cuenta    ON detalle_cuenta (id_cuenta);
CREATE INDEX idx_detalle_cuenta_venta     ON detalle_cuenta (id_venta);
CREATE INDEX idx_detalle_cuenta_pedido    ON detalle_cuenta (id_pedido);
CREATE INDEX idx_detalle_pedido_pedido    ON detalle_pedido (id_pedido);
CREATE INDEX idx_turno_sucursal_estado    ON turno_caja (id_sucursal, estado_turno);
CREATE INDEX idx_historial_inv_fecha      ON historial_inventario (id_inventario, fecha_registro);
CREATE INDEX idx_promocion_vigencia      ON promocion (estado_activo, fecha_inicio, fecha_fin);
CREATE INDEX idx_promocion_sucursal      ON promocion (id_sucursal);
CREATE INDEX idx_promocion_producto_prod ON promocion_producto (id_producto);
CREATE INDEX idx_promocion_categoria_cat ON promocion_categoria (id_categoria);
CREATE INDEX idx_detalle_venta_promocion ON detalle_venta (id_promocion);

-- ==========================================
-- COSTOS DE PRODUCCIÓN (solo administrador)
-- Unidades (base: g, ml, unidad), insumos con su precio de compra y recetas.
-- La inversión de cada receta se guarda con su historial; el costo por g / ml / unidad se calcula.
-- ==========================================

CREATE TABLE unidad_medida (
    id_unidad   SMALLSERIAL PRIMARY KEY,
    codigo      VARCHAR(12) NOT NULL UNIQUE,
    nombre      VARCHAR(30) NOT NULL,
    tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('PESO', 'VOLUMEN', 'CANTIDAD')),
    factor_base NUMERIC(14, 6) NOT NULL CHECK (factor_base > 0),
    orden       SMALLINT NOT NULL DEFAULT 0
);
INSERT INTO unidad_medida (codigo, nombre, tipo, factor_base, orden) VALUES
    ('mg', 'Miligramo', 'PESO', 0.001, 1), ('g', 'Gramo', 'PESO', 1, 2), ('kg', 'Kilogramo', 'PESO', 1000, 3),
    ('lb', 'Libra', 'PESO', 460, 4), ('arroba', 'Arroba', 'PESO', 11500, 5), ('quintal', 'Quintal', 'PESO', 46000, 6),
    ('ml', 'Mililitro', 'VOLUMEN', 1, 10), ('l', 'Litro', 'VOLUMEN', 1000, 11),
    ('cdta', 'Cucharadita', 'VOLUMEN', 5, 12), ('cda', 'Cucharada', 'VOLUMEN', 15, 13), ('taza', 'Taza', 'VOLUMEN', 240, 14),
    ('u', 'Unidad', 'CANTIDAD', 1, 20), ('docena', 'Docena', 'CANTIDAD', 12, 21), ('maple', 'Maple', 'CANTIDAD', 30, 22)
ON CONFLICT (codigo) DO NOTHING;
CREATE TABLE insumo (
    id_insumo        SERIAL PRIMARY KEY,
    nombre           VARCHAR(80) NOT NULL,
    cantidad_compra  NUMERIC(14, 4) NOT NULL CHECK (cantidad_compra > 0),
    id_unidad_compra SMALLINT NOT NULL REFERENCES unidad_medida(id_unidad),
    precio_compra    NUMERIC(12, 2) NOT NULL CHECK (precio_compra >= 0),
    fecha_precio     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_insumo_nombre ON insumo (lower(nombre));
CREATE TABLE historial_precio_insumo (
    id_historial     SERIAL PRIMARY KEY,
    id_insumo        INT NOT NULL REFERENCES insumo(id_insumo) ON DELETE CASCADE,
    cantidad_compra  NUMERIC(14, 4) NOT NULL,
    id_unidad_compra SMALLINT NOT NULL REFERENCES unidad_medida(id_unidad),
    precio_compra    NUMERIC(12, 2) NOT NULL,
    id_usuario       INT REFERENCES usuario(id_usuario),
    fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_historial_precio_insumo ON historial_precio_insumo (id_insumo, fecha);
CREATE TABLE receta (
    id_receta     SERIAL PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL,
    rendimiento   NUMERIC(10, 2) NOT NULL CHECK (rendimiento > 0),
    inversion     NUMERIC(14, 4) NOT NULL DEFAULT 0,
    fecha_calculo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    id_producto   INT REFERENCES producto(id_producto) ON DELETE SET NULL
);
CREATE UNIQUE INDEX uq_receta_nombre ON receta (lower(nombre));
CREATE UNIQUE INDEX uq_receta_producto ON receta (id_producto) WHERE id_producto IS NOT NULL;
CREATE TABLE ingrediente_receta (
    id_receta INT NOT NULL REFERENCES receta(id_receta) ON DELETE CASCADE,
    id_insumo INT NOT NULL REFERENCES insumo(id_insumo),
    cantidad  NUMERIC(14, 4) NOT NULL CHECK (cantidad > 0),
    id_unidad SMALLINT NOT NULL REFERENCES unidad_medida(id_unidad),
    PRIMARY KEY (id_receta, id_insumo)
);
CREATE INDEX idx_ingrediente_receta_insumo ON ingrediente_receta (id_insumo);
CREATE TABLE historial_inversion_receta (
    id_historial SERIAL PRIMARY KEY,
    id_receta    INT NOT NULL REFERENCES receta(id_receta) ON DELETE CASCADE,
    inversion    NUMERIC(14, 4) NOT NULL,
    rendimiento  NUMERIC(10, 2) NOT NULL,
    motivo       VARCHAR(200) NOT NULL,
    id_usuario   INT REFERENCES usuario(id_usuario),
    fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_historial_inversion_receta ON historial_inversion_receta (id_receta, fecha);

-- ==========================================
-- NOTIFICACIONES (campana y Telegram; sin auditoría, se borran a los 7 días)
-- El administrador ve todas; el cajero las de destino SUCURSAL de su sucursal y las USUARIO suyas.
-- ==========================================

CREATE TABLE notificacion (
    id_notificacion SERIAL PRIMARY KEY,
    tipo           VARCHAR(20) NOT NULL CONSTRAINT notificacion_tipo_check
                   CHECK (tipo IN ('STOCK_BAJO', 'AGOTADO', 'ARQUEO', 'CAJA_SIN_CERRAR', 'TRANSFERENCIA', 'DESCUENTO')),
    titulo         VARCHAR(80)  NOT NULL,
    mensaje        VARCHAR(300) NOT NULL,
    ruta           VARCHAR(40),
    destino        VARCHAR(10) NOT NULL DEFAULT 'ADMIN' CONSTRAINT notificacion_destino_check
                   CHECK (destino IN ('ADMIN', 'SUCURSAL', 'USUARIO')),
    id_sucursal    INT REFERENCES sucursal(id_sucursal) ON DELETE CASCADE,
    id_usuario     INT REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    id_producto    INT REFERENCES producto(id_producto) ON DELETE CASCADE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notificacion_leida (
    id_notificacion INT NOT NULL REFERENCES notificacion(id_notificacion) ON DELETE CASCADE,
    id_usuario      INT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    fecha_lectura   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_notificacion, id_usuario)
);
CREATE INDEX idx_notificacion_fecha ON notificacion (fecha_creacion DESC);
CREATE INDEX idx_notificacion_producto ON notificacion (id_producto, id_sucursal, tipo, fecha_creacion);
