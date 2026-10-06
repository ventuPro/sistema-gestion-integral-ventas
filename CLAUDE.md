# SGIV — Contexto para Claude

Sistema de Gestión Integral de Ventas e Inventario para Pastelería Ricky's (La Paz, Bolivia).
Trabajo de grado de Ingeniería de Sistemas. El autor se comunica en español: responder en español.

## Stack y cómo correrlo
- `backend-sgiv/`: Node 20 + Express 5 + PostgreSQL (`pg`) + Socket.IO. `npm run dev` (puerto 3000). Credenciales en `backend-sgiv/.env`.
- `frontend-sgiv/`: Angular 21 standalone + Tailwind 4. `ng serve --host 0.0.0.0 --port 4200`. Verificar con `npx ng build`.
- `database/`: `schema.sql` + `seed.sql` (admin: `admin@rickys.com` / `password`). Migraciones sueltas `migration_*.sql` para BD existentes.
- `docker-compose.yml` levanta postgres + backend + frontend (nginx).

## Arquitectura y convenciones
- Backend en capas: `routes/` → `controllers/` → `models/` (SQL directo con `db.query`, transacciones con `db.connect()` + BEGIN/COMMIT).
- Auth: JWT (`verificarToken`); permisos por módulo con `verificarPermiso('<modulo>')`. Rol 1 = Administrador (pasa todo), 2 = Cajero, 3 = Cocina.
  Módulos: dashboard, punto_venta, mesas, arqueo, inventario, reportes, usuarios.
- Tiempo real: `global.io`; salas `cajeros`, `cocina`, `mesa_<id_mesa>`. Evento `actualizacion_stock_global` para refrescar stock en POS/Mesas.
- Flujo de mesas: `cuenta_mesa`/`detalle_cuenta` reservan stock al agregar productos; al cerrar la cuenta se crea `venta_caja`. Pedidos QR (`pedido_mesa`) se integran a la cuenta al aprobarlos.
- Ventas exigen turno de caja abierto (`turno_caja.estado_turno = 'Abierto'`); la sesión de BD usa zona `America/La_Paz` (`config/db.js`).
- Precios siempre se toman de la BD, nunca del cliente. Imágenes: el frontend envía base64, el backend guarda en `uploads/productos` y sirve `/uploads`; en el frontend usar el pipe `imagenUrl`.
- Código y comentarios en español, con el estilo de separadores `// ─── Título ───` existente.
- `database/schema.sql` debe mantenerse sincronizado con la BD real cuando se agreguen tablas/columnas.
