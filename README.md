# SGIV — Sistema de Gestión Integral de Ventas e Inventario
### Pastelería Ricky's · La Paz, Bolivia

> Trabajo de Grado — Ingeniería de Sistemas  
> Universidad Salesiana de Bolivia  
> Autor: Brayan Richard Ventura Alvino

---

## Descripción

SGIV es un sistema web full-stack para la gestión de ventas, inventario, mesas,
menú digital QR y control de caja para pequeñas y medianas empresas.

### Módulos implementados

| Módulo | Descripción |
|---|---|
| **Autenticación** | Login con JWT, control de sesiones por rol |
| **Punto de Venta** | Registro de ventas con ticket imprimible |
| **Mesas y QR** | Plano de mesas, cuentas por mesa e impresión de códigos QR |
| **Menú Digital** | El cliente pide desde su mesa con el celular (sin instalación) |
| **Pedidos QR** | Bandeja del cajero: confirma, ajusta o rechaza los pedidos del menú |
| **Inventario** | CRUD de productos, control de stock |
| **Arqueo de Caja** | Resumen diario, apertura y cierre de caja |
| **Usuarios** | CRUD con permisos granulares por módulo |
| **Reportes** | Dashboard con gráficos y exportación PDF/Excel |
| **Cierres de Caja** | Historial de cierres por sucursal (Admin) |

---

## Stack Tecnológico

### Backend
- **Node.js** v20 + **Express** v5
- **PostgreSQL** v15
- **Socket.IO** (tiempo real)
- **JWT** + **bcryptjs** (autenticación)
- **QRCode** (generación de QR)

### Frontend
- **Angular** v21 (Standalone Components)
- **Tailwind CSS** v4
- **Chart.js** (gráficos)
- **Socket.IO Client** (tiempo real)

### DevOps
- **Docker** + **Docker Compose**
- **Nginx** (servidor del frontend en producción)

---

## Requisitos previos

### Opción A — Con Docker 
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado
- Git

### Opción A — Docker (una sola vez)

```bash
# 1. Clonar el repositorio
opcion 1: git clone https://github.com/ventuPro/sistema-gestion-integral-ventas.git
opcion 2: tambien se subio toda la carpeta del proyecto comprimido, descomprimir y seguir con los pasos

# 2. Levantar todo el sistema
dentro de la carpeta principal abrir git y ejecutar el siguiente comando

docker-compose up --build

# 3. Esperar ~2 minutos mientras se construye y luego abrir:
#    http://localhost:4200
```

> La primera vez tarda más porque descarga las imágenes y compila Angular.

---
### Opción B — Sin Docker
- Node.js v20+
- PostgreSQL v15+
- Angular CLI v21: `npm install -g @angular/cli`

---

#### Base de datos
```bash
# Crear la base de datos en PostgreSQL
psql -U postgres
CREATE DATABASE sgiv_db;
\c sgiv_db
\i database/schema.sql
\i database/seed.sql
\q
```

Si la base de datos ya existía, aplicar las migraciones pendientes `database/migration_*.sql`
(por ejemplo `psql -U postgres -d sgiv_db -f database/migration_menu_qr.sql`).

#### Backend
```bash
cd backend-sgiv

# Crear archivo de entorno
cp .env.example .env
# Editar .env con tus credenciales de PostgreSQL

# Instalar dependencias
npm install

# Iniciar en modo desarrollo
npm run dev
```

#### Frontend
```bash
cd frontend-sgiv

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
ng serve --host 0.0.0.0 --port 4200
```

#### Acceder
| Recurso | URL |
|---|---|
| Aplicación | `http://localhost:4200` |
| API | `http://localhost:3000/api` |

#### Pruebas automatizadas
```bash
cd backend-sgiv

# Unitarias + integración (requiere PostgreSQL con los datos de .env)
npm test

# Solo unitarias (no usan la base de datos)
npm run test:unitarias
```
Las pruebas de integración crean una base de datos temporal a partir de
`database/schema.sql` y `seed.sql`, levantan la API contra ella y la eliminan al
terminar; la base de datos real no se modifica.

---

## Credenciales por defecto

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@rickys.com` | `password` |

---

## Variables de entorno (Backend)

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DB_HOST` | Host de PostgreSQL | `localhost` |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_NAME` | Nombre de la base de datos | `sgiv_db` |
| `DB_USER` | Usuario de PostgreSQL | `sgiv_user` |
| `DB_PASSWORD` | Contraseña | `sgiv_password` |
| `JWT_SECRET` | Clave secreta para JWT | `clave_segura` |
| `PORT` | Puerto del servidor Node | `3000` |
| `MENU_MAX_PEDIDOS_IP` | Pedidos del menú QR permitidos por IP cada 10 min (opcional) | `10` |

---

## Estructura del proyecto

sistema/
├── docker-compose.yml
├── README.md
├── database/
│   ├── schema.sql          # Estructura completa de la BD
│   └── seed.sql            # Datos iniciales (roles, sucursal, admin)
├── backend-sgiv/
│   ├── Dockerfile
│   ├── .env.example
│   ├── src/
│   │   ├── server.js       # Punto de entrada
│   │   ├── config/
│   │   │   └── db.js       # Conexión PostgreSQL
│   │   ├── routes/         # Definición de rutas
│   │   ├── controllers/    # Lógica de negocio
│   │   ├── models/         # Consultas a la BD
│   │   └── middlewares/    # Auth JWT
│   └── package.json
└── frontend-sgiv/
├── Dockerfile
├── nginx.conf
├── src/
│   ├── app/
│   │   ├── features/   # Módulos por feature
│   │   │   ├── admin/  # Dashboard, POS, Inventario...
│   │   │   └── cliente/# Menú digital (QR)
│   │   ├── core/
│   │   │   ├── services/   # Servicios HTTP
│   │   │   └── guards/     # Protección de rutas
│   │   └── app.routes.ts
│   └── environments/
└── package.json

## Rutas del sistema

| Ruta | Acceso | Descripción |
|---|---|---|
| `/login` | Público | Inicio de sesión |
| `/dashboard` | Admin / Cajero | Panel principal |
| `/dashboard/punto-venta` | Cajero | Punto de venta |
| `/dashboard/mesas` | Cajero | Gestión de mesas |
| `/dashboard/arqueo` | Cajero | Arqueo de caja |
| `/dashboard/inventario` | Admin / Cajero | Inventario |
| `/dashboard/reportes` | Admin | Reportes y gráficos |
| `/dashboard/usuarios` | Admin | Gestión de usuarios |
| `/dashboard/cierres-caja` | Admin | Historial cierres |
| `/menu/:codigo` | Público | Menú digital QR (código aleatorio de la mesa) |

## Flujo del sistema

Cliente (celular)
│ Escanea el QR de su mesa
▼
Menú Digital (/menu/:codigo) — ve el stock real, en vivo
│ Envía pedido → el stock se reserva al instante
▼
Cajero (bandeja "Pedidos QR", visible en cualquier pantalla, con aviso sonoro)
│ Confirma (puede ajustar cantidades) o rechaza (el stock vuelve)
▼
El pedido se suma a la cuenta de la mesa — el cliente lo ve "Confirmado"
│ El cliente puede pedir más (no reducir lo confirmado)
▼
Cajero marca "Entregado" al llevarlo a la mesa
│
▼
Al final, el cajero cobra la cuenta de la mesa → venta + ticket; pedidos "Pagado"

Estados del pedido: `Pendiente_Cajero → Confirmado → Entregado → Pagado` (o `Cancelado`).
La tabla `pedido_mesa` ya está preparada para pedidos a delivery (`tipo_pedido`,
`id_sucursal` y datos de contacto del cliente).

## API REST (resumen)

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/usuarios/login` | Autenticación |
| GET | `/api/catalogo/productos` | Listar productos |
| POST | `/api/caja/cobrar` | Registrar venta |
| GET | `/api/caja/arqueo/:id` | Arqueo del día |
| GET | `/api/reportes/dashboard/:id` | Dashboard |
| GET | `/api/menu/m/:codigo/catalogo` | Menú público QR |
| POST | `/api/menu/m/:codigo/pedidos` | Crear pedido desde QR (público) |
| GET | `/api/menu/m/:codigo/estado` | Estado de los pedidos y consumo de la mesa (público) |
| GET | `/api/pedidos/bandeja` | Pedidos por confirmar y por entregar (cajero) |
| POST | `/api/pedidos/:id/confirmar` · `rechazar` · `entregado` | Atender un pedido (cajero) |


## Notas

- El sistema usa **Socket.IO** para notificaciones en tiempo real entre el cajero y el cliente (stock, pedidos y cuenta de la mesa).
- Las contraseñas se almacenan con **bcrypt** (10 salt rounds).
- Todas las rutas protegidas requieren **Bearer Token** JWT en el header.
- El menú digital (`/menu/:codigo`) es **público** — no requiere autenticación. Cada mesa tiene un código aleatorio
  (no su número interno), y el cajero puede generar uno nuevo para invalidar un QR impreso.
- Los QR se imprimen desde **Mesas → Códigos QR**. La dirección debe ser la IP del equipo en la red del local
  (por ejemplo `http://192.168.1.10:4200`), no `localhost`, para que abra en el celular del cliente.
- Los permisos son **granulares por módulo** — el administrador los asigna por usuario.
- La URL del backend es **dinámica** — usa `window.location.hostname` para funcionar en cualquier red sin reconfiguración.

## Autor

**Brayan Richard Ventura Alvino**  
Ingeniería de Sistemas — Universidad Salesiana de Bolivia  
La Paz, Bolivia · 2026