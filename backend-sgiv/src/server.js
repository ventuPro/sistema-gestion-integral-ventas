const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');

// Importar rutas
const userRoutes = require('./routes/userRoutes');
const productoRoutes = require('./routes/productoRoutes');
const inventarioRoutes = require('./routes/inventarioRoutes');
const pedidoRoutes = require('./routes/pedidoRoutes');
const cajaRoutes = require('./routes/cajaRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// --- MONTAR RUTAS ---
app.use('/api/usuarios', userRoutes); // Toda ruta de usuarios empezará con /api/usuarios
app.use('/api/catalogo', productoRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/pedidos', pedidoRoutes);
app.use('/api/caja', cajaRoutes);

app.get('/', (req, res) => {
    res.json({ mensaje: '🚀 API del Sistema SGIV funcionando correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});