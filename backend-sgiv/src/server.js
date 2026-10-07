const express    = require('express');
const path       = require('path');
const cors       = require('cors');
const http       = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const db = require('./config/db');
const jwt = require('jsonwebtoken');
const { origenPermitido, JWT_SECRET, JWT_ALGORITMOS } = require('./config/seguridad');

const userRoutes      = require('./routes/userRoutes');
const productoRoutes  = require('./routes/productoRoutes');
const inventarioRoutes = require('./routes/inventarioRoutes');
const pedidoRoutes    = require('./routes/pedidoRoutes');
const cajaRoutes      = require('./routes/cajaRoutes');
const reporteRoutes   = require('./routes/reporteRoutes');
const sucursalRoutes  = require('./routes/sucursalRoutes');
const permisoRoutes   = require('./routes/permisoRoutes');
const menuRoutes      = require('./routes/menuRoutes');
const mesaRoutes      = require('./routes/mesaRoutes');

const app    = express();
const server = http.createServer(app);

// Socket.IO con CORS restringido a los orígenes permitidos
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  },
  allowRequest: (req, callback) => {
    callback(null, origenPermitido(req.headers.origin, req.headers.host));
  }
});

// Exportar io para usarlo en controllers
global.io = io;

// ─── CORS ───
// El menú digital (QR) es público y acepta cualquier origen; el resto de la API
// solo responde a los orígenes permitidos (ver config/seguridad.js).
app.use(cors((req, callback) => {
    const publico = req.path.startsWith('/api/menu');
    callback(null, {
        origin:         publico || origenPermitido(req.headers.origin, req.headers.host),
        methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials:    false
    });
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Imágenes de productos guardadas por uploadMiddleware
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Rutas
app.use('/api/usuarios',   userRoutes);
app.use('/api/catalogo',   productoRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/pedidos',    pedidoRoutes);
app.use('/api/caja',       cajaRoutes);
app.use('/api/reportes',   reporteRoutes);
app.use('/api/sucursales', sucursalRoutes);
app.use('/api/permisos',   permisoRoutes);
app.use('/api/menu',       menuRoutes);    // Público (sin auth)
app.use('/api/mesas',      mesaRoutes);
app.use('/api/cuentas', require('./routes/cuentaRoutes'));

// Socket.IO eventos
io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id}`);

    // Personal del sistema: la sala 'cajeros' exige un token válido
    socket.on('unirse_sala', async (sala, token) => {
        if (sala !== 'cajeros') return;
        try {
            const payload = jwt.verify(String(token || ''), JWT_SECRET, { algorithms: JWT_ALGORITMOS });
            const r = await db.query(
                `SELECT 1 FROM usuario WHERE id_usuario = $1 AND estado_activo = TRUE`, [payload.id_usuario]);
            if (!r.rows.length) return;
            socket.join(sala);
            console.log(`📡 ${socket.id} unido a sala: ${sala}`);
        } catch { /* token inválido: no se une */ }
    });

    // Menú digital: el cliente se une a la sala de su mesa con el código QR
    socket.on('unirse_mesa', async (codigo) => {
        try {
            const r = await db.query(`SELECT id_mesa FROM mesa_local WHERE codigo_qr = $1`, [String(codigo || '')]);
            if (r.rows.length) socket.join(`mesa_${r.rows[0].id_mesa}`);
        } catch (e) {
            console.error('unirse_mesa:', e.message);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
    });
});

app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 API del Sistema SGIV v2 funcionando' });
});

// Solo escucha cuando se ejecuta directamente (npm run dev / start);
// las pruebas automatizadas importan app y server sin abrir el puerto 3000.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Servidor + WebSocket corriendo en puerto ${PORT}`);
    });
    require('./controllers/pedidoController').iniciarExpiracion();
}

module.exports = { app, server, io };