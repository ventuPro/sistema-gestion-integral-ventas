const db = require('./db');

// ─── Migraciones automáticas ───
// Se ejecutan al iniciar el backend, antes de instalar la auditoría (así las
// tablas nuevas también reciben sus triggers). Son idempotentes: una BD que ya
// las tiene no cambia. database/schema.sql tiene la misma estructura.
const MIGRACIONES = [
    // Ajustes → Empresa y Apariencia: una sola fila con los valores originales
    `CREATE TABLE IF NOT EXISTS configuracion (
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
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO configuracion (id_configuracion) VALUES (1) ON CONFLICT DO NOTHING;`,

    // Ajustes → Sucursales: activa/inactiva y horario por día (1 = lunes … 7 = domingo)
    `ALTER TABLE sucursal ADD COLUMN IF NOT EXISTS estado_activo BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE TABLE IF NOT EXISTS horario_sucursal (
        id_sucursal   INT NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE CASCADE,
        dia_semana    SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
        abierto       BOOLEAN NOT NULL DEFAULT TRUE,
        hora_apertura TIME,
        hora_cierre   TIME,
        PRIMARY KEY (id_sucursal, dia_semana),
        CHECK (NOT abierto OR (hora_apertura IS NOT NULL AND hora_cierre IS NOT NULL AND hora_apertura <> hora_cierre))
    );`,

    // Ajustes → Propietarios
    `CREATE TABLE IF NOT EXISTS propietario (
        id_propietario   SERIAL PRIMARY KEY,
        nombre_completo  VARCHAR(100) NOT NULL,
        ci               VARCHAR(20) UNIQUE,
        cargo            VARCHAR(60),
        telefono         VARCHAR(20),
        correo           VARCHAR(100),
        porcentaje_participacion NUMERIC(5, 2) NOT NULL DEFAULT 0
            CHECK (porcentaje_participacion BETWEEN 0 AND 100),
        fecha_registro   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,

    // Ajustes → Parámetros (ventas, menú QR, inventario, seguridad)
    `ALTER TABLE configuracion
        ADD COLUMN IF NOT EXISTS moneda_simbolo      VARCHAR(5)   NOT NULL DEFAULT 'Bs.',
        ADD COLUMN IF NOT EXISTS pago_efectivo       BOOLEAN      NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS pago_qr             BOOLEAN      NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS url_qr_cobro        TEXT,
        ADD COLUMN IF NOT EXISTS ticket_mensaje_pie  VARCHAR(150) NOT NULL DEFAULT '¡Gracias por su compra!',
        ADD COLUMN IF NOT EXISTS menu_activo              BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS menu_mensaje_bienvenida  VARCHAR(200),
        ADD COLUMN IF NOT EXISTS menu_minutos_expiracion  INT NOT NULL DEFAULT 15 CHECK (menu_minutos_expiracion BETWEEN 5 AND 120),
        ADD COLUMN IF NOT EXISTS menu_max_pendientes_mesa INT NOT NULL DEFAULT 3  CHECK (menu_max_pendientes_mesa BETWEEN 1 AND 10),
        ADD COLUMN IF NOT EXISTS menu_max_pedidos_ip      INT NOT NULL DEFAULT 10 CHECK (menu_max_pedidos_ip BETWEEN 1 AND 100),
        ADD COLUMN IF NOT EXISTS stock_minimo_defecto     INT NOT NULL DEFAULT 5  CHECK (stock_minimo_defecto BETWEEN 0 AND 10000),
        ADD COLUMN IF NOT EXISTS captcha_activo           BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS login_max_intentos       INT NOT NULL DEFAULT 5  CHECK (login_max_intentos BETWEEN 3 AND 20),
        ADD COLUMN IF NOT EXISTS login_minutos_bloqueo    INT NOT NULL DEFAULT 15 CHECK (login_minutos_bloqueo BETWEEN 1 AND 1440),
        ADD COLUMN IF NOT EXISTS sesion_horas             INT NOT NULL DEFAULT 8  CHECK (sesion_horas BETWEEN 1 AND 24);
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configuracion_metodo_pago_check') THEN
            ALTER TABLE configuracion ADD CONSTRAINT configuracion_metodo_pago_check CHECK (pago_efectivo OR pago_qr);
        END IF;
    END $$;`,

    // Ajustes → Parámetros: ancho del ticket (58 mm, 80 mm o A4)
    `ALTER TABLE configuracion
        ADD COLUMN IF NOT EXISTS ticket_ancho VARCHAR(3) NOT NULL DEFAULT '80' CHECK (ticket_ancho IN ('58', '80', 'A4'));`,

    // Texto grande de la pantalla de inicio de sesión (NULL = nombre comercial)
    `ALTER TABLE configuracion ADD COLUMN IF NOT EXISTS login_titulo VARCHAR(100);`,

    // Índices de las consultas frecuentes (panel, informes, arqueo, cuentas)
    `CREATE INDEX IF NOT EXISTS idx_venta_caja_sucursal_fecha ON venta_caja (id_sucursal, fecha_venta);
    CREATE INDEX IF NOT EXISTS idx_venta_caja_turno          ON venta_caja (id_turno);
    CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta       ON detalle_venta (id_venta);
    CREATE INDEX IF NOT EXISTS idx_detalle_venta_producto    ON detalle_venta (id_producto);
    CREATE INDEX IF NOT EXISTS idx_detalle_cuenta_cuenta     ON detalle_cuenta (id_cuenta);
    CREATE INDEX IF NOT EXISTS idx_detalle_pedido_pedido     ON detalle_pedido (id_pedido);
    CREATE INDEX IF NOT EXISTS idx_turno_sucursal_estado     ON turno_caja (id_sucursal, estado_turno);
    CREATE INDEX IF NOT EXISTS idx_historial_inv_fecha       ON historial_inventario (id_inventario, fecha_registro);
    CREATE INDEX IF NOT EXISTS idx_mesa_sucursal_numero      ON mesa_local (id_sucursal, numero_mesa);`,

    // Movimientos de inventario: saldo después de cada movimiento y observación libre
    `ALTER TABLE historial_inventario
        ADD COLUMN IF NOT EXISTS stock_resultante INT,
        ADD COLUMN IF NOT EXISTS detalle          VARCHAR(200);
    DROP INDEX IF EXISTS idx_historial_inventario;`,

    // Chatbots con Groq: siempre activos si hay clave; modelos y límites automáticos
    `ALTER TABLE configuracion
        ADD COLUMN IF NOT EXISTS ia_info_negocio VARCHAR(3000);
    ALTER TABLE configuracion ALTER COLUMN ia_info_negocio TYPE VARCHAR(3000);
    ALTER TABLE configuracion
        DROP COLUMN IF EXISTS ia_cliente_activo, DROP COLUMN IF EXISTS ia_interno_activo,
        DROP COLUMN IF EXISTS ia_modelo_cliente, DROP COLUMN IF EXISTS ia_modelo_interno,
        DROP COLUMN IF EXISTS ia_limite_cliente, DROP COLUMN IF EXISTS ia_limite_interno;`,

    // Menú QR: cada celular se identifica con un código propio (consumo y cobro por persona)
    `ALTER TABLE pedido_mesa
        ADD COLUMN IF NOT EXISTS cliente_mesa VARCHAR(32);
    ALTER TABLE detalle_cuenta
        ADD COLUMN IF NOT EXISTS cliente_mesa   VARCHAR(32),
        ADD COLUMN IF NOT EXISTS nombre_cliente VARCHAR(40),
        ADD COLUMN IF NOT EXISTS id_venta       INT REFERENCES venta_caja(id_venta);`,

    // Promociones (reemplaza la tabla promocion original, que nunca se usó) y descuentos en las ventas
    `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'promocion' AND column_name = 'precio_promocional') THEN
            DROP TABLE promocion CASCADE;
        END IF;
    END $$;
    -- Promociones: se aplican solas al cobrar y siempre gana la que más ahorra al cliente
    -- tipo: PORCENTAJE (valor = %), PRECIO (valor = precio especial por unidad),
    --       NXM (lleva/paga, ej. 3x2), COMBO (valor = precio del combo; productos con cantidad)
    CREATE TABLE IF NOT EXISTS promocion (
        id_promocion  SERIAL PRIMARY KEY,
        nombre        VARCHAR(80) NOT NULL,
        tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('PORCENTAJE', 'PRECIO', 'NXM', 'COMBO')),
        valor         DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
        lleva         SMALLINT CHECK (lleva BETWEEN 2 AND 20),
        paga          SMALLINT CHECK (paga >= 1),
        id_sucursal   INT REFERENCES sucursal(id_sucursal),
        fecha_inicio  DATE NOT NULL,
        fecha_fin     DATE NOT NULL,
        dias_semana   SMALLINT[],
        hora_inicio   TIME,
        hora_fin      TIME,
        estado_activo BOOLEAN NOT NULL DEFAULT TRUE,
        id_usuario_creador INT REFERENCES usuario(id_usuario),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (fecha_inicio <= fecha_fin),
        CHECK ((hora_inicio IS NULL) = (hora_fin IS NULL)),
        CHECK (tipo <> 'NXM' OR (lleva IS NOT NULL AND paga IS NOT NULL AND paga < lleva))
    );

    CREATE TABLE IF NOT EXISTS promocion_producto (
        id_promocion INT NOT NULL REFERENCES promocion(id_promocion) ON DELETE CASCADE,
        id_producto  INT NOT NULL REFERENCES producto(id_producto),
        cantidad     SMALLINT NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 50),
        PRIMARY KEY (id_promocion, id_producto)
    );

    CREATE TABLE IF NOT EXISTS promocion_categoria (
        id_promocion INT NOT NULL REFERENCES promocion(id_promocion) ON DELETE CASCADE,
        id_categoria INT NOT NULL REFERENCES categoria_producto(id_categoria),
        PRIMARY KEY (id_promocion, id_categoria)
    );
    ALTER TABLE venta_caja
        ADD COLUMN IF NOT EXISTS descuento_promociones DECIMAL(10, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS descuento_manual      DECIMAL(10, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS motivo_descuento      VARCHAR(120);
    ALTER TABLE detalle_venta
        ADD COLUMN IF NOT EXISTS descuento_promocion DECIMAL(10, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS descuento_manual    DECIMAL(10, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS id_promocion        INT REFERENCES promocion(id_promocion);
    -- Sin tope para el descuento manual (el parámetro existió unos días)
    ALTER TABLE configuracion DROP COLUMN IF EXISTS descuento_max_cajero;
    CREATE INDEX IF NOT EXISTS idx_promocion_vigencia      ON promocion (estado_activo, fecha_inicio, fecha_fin);
    CREATE INDEX IF NOT EXISTS idx_promocion_sucursal      ON promocion (id_sucursal);
    CREATE INDEX IF NOT EXISTS idx_promocion_producto_prod ON promocion_producto (id_producto);
    CREATE INDEX IF NOT EXISTS idx_promocion_categoria_cat ON promocion_categoria (id_categoria);
    CREATE INDEX IF NOT EXISTS idx_detalle_venta_promocion ON detalle_venta (id_promocion);`,

    // Menú QR: orden de categorías (lo define el admin), ficha del producto y recomendados de la casa
    `ALTER TABLE categoria_producto ADD COLUMN IF NOT EXISTS orden SMALLINT;
    UPDATE categoria_producto SET orden = id_categoria WHERE orden IS NULL;
    ALTER TABLE categoria_producto ALTER COLUMN orden SET DEFAULT 0, ALTER COLUMN orden SET NOT NULL;
    ALTER TABLE producto
        ADD COLUMN IF NOT EXISTS ingredientes TEXT,
        ADD COLUMN IF NOT EXISTS preparacion  TEXT,
        ADD COLUMN IF NOT EXISTS destacado    BOOLEAN NOT NULL DEFAULT FALSE;`,

    // Menú QR: visita del cliente, mesa habilitada, pedidos sin verificar y bloqueos por pedido falso
    `ALTER TABLE mesa_local
        ADD COLUMN IF NOT EXISTS fecha_habilitacion TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS fecha_liberacion   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS codigo_visita      VARCHAR(32);
    UPDATE mesa_local SET fecha_habilitacion = NOW() WHERE estado_mesa = 'Ocupada' AND fecha_habilitacion IS NULL;
    ALTER TABLE pedido_mesa
        ADD COLUMN IF NOT EXISTS sin_verificar BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ip_cliente    VARCHAR(45);
    CREATE TABLE IF NOT EXISTS bloqueo_menu (
        id_bloqueo   SERIAL PRIMARY KEY,
        id_mesa      INT NOT NULL REFERENCES mesa_local(id_mesa) ON DELETE CASCADE,
        cliente_mesa VARCHAR(32),
        ip_cliente   VARCHAR(45),
        id_pedido    INT REFERENCES pedido_mesa(id_pedido) ON DELETE SET NULL,
        id_usuario   INT REFERENCES usuario(id_usuario),
        fecha_bloqueo TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        bloqueado_hasta TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bloqueo_menu_mesa  ON bloqueo_menu (id_mesa, bloqueado_hasta);
    CREATE INDEX IF NOT EXISTS idx_mesa_estado_habilitacion ON mesa_local (estado_mesa, fecha_habilitacion);
    ALTER TABLE configuracion
        ADD COLUMN IF NOT EXISTS menu_visita_horas       INT NOT NULL DEFAULT 3  CHECK (menu_visita_horas BETWEEN 1 AND 12),
        ADD COLUMN IF NOT EXISTS menu_visita_inactividad INT NOT NULL DEFAULT 30 CHECK (menu_visita_inactividad BETWEEN 10 AND 240),
        ADD COLUMN IF NOT EXISTS menu_bloqueo_horas      INT NOT NULL DEFAULT 6  CHECK (menu_bloqueo_horas BETWEEN 1 AND 72),
        ADD COLUMN IF NOT EXISTS menu_qr_visita          BOOLEAN NOT NULL DEFAULT FALSE;`,

    // Transferencias de productos entre sucursales (directas: salen del origen y entran al destino a la vez)
    `CREATE TABLE IF NOT EXISTS transferencia (
        id_transferencia    SERIAL PRIMARY KEY,
        id_sucursal_origen  INT NOT NULL REFERENCES sucursal(id_sucursal),
        id_sucursal_destino INT NOT NULL REFERENCES sucursal(id_sucursal),
        id_usuario          INT REFERENCES usuario(id_usuario),
        observacion         VARCHAR(200),
        fecha_transferencia TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (id_sucursal_origen <> id_sucursal_destino)
    );
    CREATE TABLE IF NOT EXISTS detalle_transferencia (
        id_transferencia INT NOT NULL REFERENCES transferencia(id_transferencia),
        id_producto      INT NOT NULL REFERENCES producto(id_producto),
        cantidad         INT NOT NULL CHECK (cantidad > 0),
        PRIMARY KEY (id_transferencia, id_producto)
    );
    CREATE INDEX IF NOT EXISTS idx_transferencia_origen_fecha  ON transferencia (id_sucursal_origen, fecha_transferencia);
    CREATE INDEX IF NOT EXISTS idx_transferencia_destino_fecha ON transferencia (id_sucursal_destino, fecha_transferencia);`,

    // Quién cerró cada turno: el cajero, el administrador o el sistema (cierre automático a las 00:00)
    `ALTER TABLE turno_caja
        ADD COLUMN IF NOT EXISTS cerrado_por VARCHAR(15) CHECK (cerrado_por IN ('Cajero', 'Administrador', 'Sistema'));
    CREATE INDEX IF NOT EXISTS idx_turno_estado_apertura ON turno_caja (estado_turno, fecha_hora_apertura);`,

    // Foto del stock de cada sucursal al terminar el día (lista de productos que quedaron)
    `CREATE TABLE IF NOT EXISTS foto_stock (
        id_foto         SERIAL PRIMARY KEY,
        id_sucursal     INT NOT NULL REFERENCES sucursal(id_sucursal),
        fecha           DATE NOT NULL,
        fecha_toma      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        desbloqueada_por INT REFERENCES usuario(id_usuario),
        fecha_desbloqueo TIMESTAMPTZ,
        UNIQUE (id_sucursal, fecha)
    );
    CREATE TABLE IF NOT EXISTS detalle_foto_stock (
        id_foto     INT NOT NULL REFERENCES foto_stock(id_foto),
        id_producto INT NOT NULL REFERENCES producto(id_producto),
        cantidad    INT NOT NULL,
        PRIMARY KEY (id_foto, id_producto)
    );`
];

const aplicarMigraciones = async () => {
    for (const sql of MIGRACIONES) await db.query(sql);
};

module.exports = { aplicarMigraciones };
