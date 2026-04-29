const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');

const userRoutes      = require('./routes/userRoutes');
const productoRoutes  = require('./routes/productoRoutes');
const inventarioRoutes = require('./routes/inventarioRoutes');
const pedidoRoutes    = require('./routes/pedidoRoutes');
const cajaRoutes      = require('./routes/cajaRoutes');
const reporteRoutes   = require('./routes/reporteRoutes');
const sucursalRoutes  = require('./routes/sucursalRoutes');

const app = express();

app.use(cors());
// FIX IMAGEN: aumentar límite para permitir base64 hasta 10MB
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/usuarios',   userRoutes);
app.use('/api/catalogo',   productoRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/pedidos',    pedidoRoutes);
app.use('/api/caja',       cajaRoutes);
app.use('/api/reportes',   reporteRoutes);
app.use('/api/sucursales', sucursalRoutes);

app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 API del Sistema SGIV funcionando correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});