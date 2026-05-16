const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

require('./config/db');

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
const kdsRoutes       = require('./routes/kdsRoutes');

const app    = express();
const server = http.createServer(app);

// Socket.IO con CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Exportar io para usarlo en controllers
global.io = io;

app.use(cors({
  origin: '*',   // En producción real limitarías esto, en desarrollo local está bien
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
app.use('/api/kds',        kdsRoutes);
app.use('/api/cuentas', require('./routes/cuentaRoutes'));

// Socket.IO eventos
io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id}`);

    // El cliente se une a una sala según su rol
    socket.on('unirse_sala', (sala) => {
        socket.join(sala);
        console.log(`📡 ${socket.id} unido a sala: ${sala}`);
    });

    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
    });
});

app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 API del Sistema SGIV v2 funcionando' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor + WebSocket corriendo en puerto ${PORT}`);
});