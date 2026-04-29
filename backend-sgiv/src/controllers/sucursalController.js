const sucursalModel = require('../models/sucursalModel');

const listarSucursales = async (req, res) => {
    try {
        const sucursales = await sucursalModel.obtenerSucursales();
        res.json(sucursales);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener sucursales' });
    }
};

const crearSucursal = async (req, res) => {
    try {
        const { nombre_sucursal, direccion_fisica, telefono_contacto } = req.body;
        if (!nombre_sucursal) return res.status(400).json({ error: 'El nombre es obligatorio' });
        const nueva = await sucursalModel.crearSucursal(nombre_sucursal, direccion_fisica, telefono_contacto);
        res.status(201).json({ mensaje: 'Sucursal creada', sucursal: nueva });
    } catch (error) {
        res.status(500).json({ error: 'Error al crear la sucursal' });
    }
};

module.exports = { listarSucursales, crearSucursal };