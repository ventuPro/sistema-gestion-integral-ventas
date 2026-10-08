const { AsyncLocalStorage } = require('async_hooks');

// ─── Contexto de auditoría de la petición en curso ───
// config/db.js lo envía a PostgreSQL en cada consulta para que los triggers
// sepan quién hizo el cambio.
const almacen = new AsyncLocalStorage();

const SISTEMA = { usuario: 'Sistema', origen: 'Proceso interno del backend' };

const actual = () => almacen.getStore() || SISTEMA;

const ejecutar = (contexto, fn) => almacen.run(contexto, fn);

const asignarUsuario = (id_usuario, usuario) => {
    const c = almacen.getStore();
    if (c) { c.id_usuario = id_usuario; c.usuario = usuario; }
};

module.exports = { actual, ejecutar, asignarUsuario };
