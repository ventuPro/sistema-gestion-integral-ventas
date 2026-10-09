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
    );`
];

const aplicarMigraciones = async () => {
    for (const sql of MIGRACIONES) await db.query(sql);
};

module.exports = { aplicarMigraciones };
