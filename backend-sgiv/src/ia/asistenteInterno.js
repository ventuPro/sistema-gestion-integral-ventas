const ajusteModel   = require('../models/ajusteModel');
const reporteModel  = require('../models/reporteModel');
const productoModel = require('../models/productoModel');
const pedidoModel   = require('../models/pedidoModel');
const cajaModel     = require('../models/cajaModel');
const sucursalModel = require('../models/sucursalModel');
const permisoModel  = require('../models/permisoModel');
const userModel     = require('../models/userModel');
const { guiasPermitidas } = require('./conocimiento');
const { METODO_PAGO } = require('../utils/metodosPago');
const groq          = require('./groq');

// ─── Asistente del personal (cajero y administrador) ───
// Solo funciones de lectura. Cada una se ofrece si el usuario tiene el permiso
// del módulo, y el cajero queda limitado a su sucursal aunque el modelo pida otra.
const FECHA    = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 366;

const errorPublico = (mensaje) => Object.assign(new Error(mensaje), { publico: true });
const hoyLaPaz = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

const parametroSucursal = (esAdmin, descripcion) => esAdmin
    ? { id_sucursal: { type: ['integer', 'null'], description: `${descripcion} Usa listar_sucursales para conocer los id.` } }
    : {};

const crearHerramientas = ({ usuario, esAdmin, permisos, guias }) => {
    const puede = (...modulos) => esAdmin || modulos.some(m => permisos[m] === true);

    // Cajero: siempre la suya. Administrador: la pedida o, si no indica, todas (0)
    const sucursal = (pedida, todas = true) => {
        if (!esAdmin) return Number(usuario.id_sucursal);
        const n = Number(pedida);
        if (Number.isInteger(n) && n > 0) return n;
        return todas ? 0 : Number(usuario.id_sucursal);
    };

    const sucursales = () => sucursalModel.obtenerSucursales();
    const nombreSucursal = async (id) => id === 0 ? 'Todas' : (await sucursales()).find(s => s.id_sucursal === id)?.nombre_sucursal;

    const h = {};

    if (esAdmin) h.listar_sucursales = {
        descripcion: 'Lista las sucursales con su id y si están activas.',
        ejecutar: async () => (await sucursales()).map(s => ({ id_sucursal: s.id_sucursal, nombre: s.nombre_sucursal, activa: s.estado_activo }))
    };

    if (puede('dashboard')) h.ventas_de_hoy = {
        descripcion: 'Ventas de hoy: ingresos, cantidad de ventas, ticket promedio, comparación con ayer, cobros por método, más vendidos, turnos de caja abiertos, mesas por cobrar, pedidos QR y resumen de stock.',
        parametros: { type: 'object', properties: parametroSucursal(esAdmin, 'Sucursal (omitir = todas).') },
        ejecutar: async ({ id_sucursal } = {}) => {
            const id = sucursal(id_sucursal);
            const p = await reporteModel.obtenerPanel(id);
            return {
                sucursal: await nombreSucursal(id), hoy: p.hoy, comparativo: p.comparativo, metodos_pago: p.metodos_pago,
                mas_vendidos: p.top_productos.slice(0, 5), turnos_abiertos: p.turnos_abiertos.map(t => ({
                    cajero: t.cajero, sucursal: t.nombre_sucursal, apertura: t.fecha_hora_apertura,
                    fondo_inicial: t.monto_inicial, ventas: t.ventas, total: t.total, efectivo_cobrado: t.efectivo })),
                mesas: p.mesas, pedidos_qr: p.pedidos_qr, stock: p.stock
            };
        }
    };

    if (puede('reportes')) h.informe_periodo = {
        descripcion: 'Informe de ventas entre dos fechas (inclusive): totales, comparación con el período anterior, mejor día, métodos de pago, cajeros, categorías, productos más y menos vendidos, inventario y pedidos QR.',
        parametros: { type: 'object', required: ['fecha_inicio', 'fecha_fin'], properties: {
            fecha_inicio: { type: 'string', description: 'YYYY-MM-DD' },
            fecha_fin:    { type: 'string', description: 'YYYY-MM-DD' },
            ...parametroSucursal(esAdmin, 'Sucursal (omitir = todas).')
        }},
        ejecutar: async ({ fecha_inicio, fecha_fin, id_sucursal } = {}) => {
            if (!FECHA.test(fecha_inicio || '') || !FECHA.test(fecha_fin || '')) throw errorPublico('Fechas inválidas (formato YYYY-MM-DD)');
            const dias = (Date.parse(fecha_fin) - Date.parse(fecha_inicio)) / 86400000 + 1;
            if (!(dias >= 1 && dias <= MAX_DIAS)) throw errorPublico(`El período debe tener entre 1 y ${MAX_DIAS} días`);
            const id = sucursal(id_sucursal);
            const i = await reporteModel.obtenerInforme(id, fecha_inicio, fecha_fin);
            const mejor = i.ventas_diarias.reduce((m, d) => (d.ingresos > (m?.ingresos ?? 0) ? d : m), null);
            return {
                sucursal: await nombreSucursal(id), periodo: [fecha_inicio, fecha_fin], resumen: i.resumen,
                periodo_anterior: { fechas: i.periodo_anterior, ...i.anterior }, mejor_dia: mejor,
                metodos_pago: i.metodos_pago, por_cajero: i.por_cajero.slice(0, 10), por_sucursal: i.por_sucursal,
                por_categoria: i.por_categoria.slice(0, 10).map(c => ({ categoria: c.nombre_categoria.trim(), unidades: c.unidades, ingresos: c.ingresos })),
                mas_vendidos: i.productos.slice(0, 10).map(p => ({ producto: p.nombre_producto, unidades: p.unidades, ingresos: p.ingresos })),
                productos_sin_ventas: i.sin_ventas.length, inventario: i.inventario, pedidos_qr: i.pedidos_qr
            };
        }
    };

    if (puede('inventario', 'punto_venta', 'mesas')) h.consultar_stock = {
        descripcion: 'Stock de productos: busca por nombre o categoría, o lista los que están en o bajo su stock mínimo.',
        parametros: { type: 'object', properties: {
            buscar:    { type: ['string', 'null'], description: 'Parte del nombre del producto o de la categoría' },
            solo_bajo: { type: ['boolean', 'null'], description: 'true = solo agotados o bajo el mínimo' },
            ...parametroSucursal(esAdmin, 'Sucursal (omitir = todas las activas).')
        }},
        ejecutar: async ({ buscar, solo_bajo, id_sucursal } = {}) => {
            const id = sucursal(id_sucursal);
            const lista = id === 0 ? (await sucursales()).filter(s => s.estado_activo) : [{ id_sucursal: id, nombre_sucursal: await nombreSucursal(id) }];
            const texto = String(buscar || '').trim().toLowerCase();
            const filas = [];
            for (const s of lista) {
                for (const p of await productoModel.obtenerProductos(s.id_sucursal)) {
                    const stock = Number(p.stock_actual), minimo = Number(p.stock_minimo_alerta);
                    if (solo_bajo && stock > minimo) continue;
                    if (texto && !`${p.nombre_producto} ${p.nombre_categoria}`.toLowerCase().includes(texto)) continue;
                    filas.push({ producto: p.nombre_producto, categoria: p.nombre_categoria.trim(), stock, minimo,
                                 precio: Number(p.precio_unitario), ...(lista.length > 1 ? { sucursal: s.nombre_sucursal } : {}) });
                }
            }
            filas.sort((a, b) => a.stock - b.stock);
            return { encontrados: filas.length, productos: filas.slice(0, 40), recortado: filas.length > 40 };
        }
    };

    if (puede('mesas')) h.pedidos_qr = {
        descripcion: 'Pedidos del menú QR por atender (pendientes de confirmar y confirmados por entregar).',
        parametros: { type: 'object', properties: parametroSucursal(esAdmin, 'Sucursal (omitir = la del usuario).') },
        ejecutar: async ({ id_sucursal } = {}) => {
            const p = await ajusteModel.parametros();
            const pedidos = await pedidoModel.obtenerBandeja(sucursal(id_sucursal, false), p.menu_minutos_expiracion);
            return pedidos.map(x => ({
                pedido: x.id_pedido, mesa: x.numero_mesa, estado: x.estado_pedido, monto: Number(x.monto_total),
                minutos_esperando: Math.round((Date.now() - new Date(x.fecha_pedido)) / 60000),
                productos: x.items.map(i => `${i.cantidad} x ${i.nombre_producto}`).join(', ')
            }));
        }
    };

    if (puede('arqueo', 'punto_venta')) h.estado_caja = {
        descripcion: 'Estado de la caja: si el usuario tiene su caja abierta y los turnos abiertos de la sucursal con lo vendido y el efectivo cobrado.',
        parametros: { type: 'object', properties: parametroSucursal(esAdmin, 'Sucursal (omitir = todas).') },
        ejecutar: async ({ id_sucursal } = {}) => {
            const id = sucursal(id_sucursal);
            const [propia, panel] = await Promise.all([
                esAdmin ? null : cajaModel.obtenerEstadoCompleto(usuario.id_usuario),
                reporteModel.obtenerPanel(id)
            ]);
            return {
                ...(propia ? { mi_caja: { estado: propia.estado, puede_vender: propia.puede_vender,
                                          apertura: propia.turno?.fecha_hora_apertura, fondo_inicial: propia.turno?.monto_inicial } } : {}),
                turnos_abiertos: panel.turnos_abiertos.map(t => ({
                    cajero: t.cajero, sucursal: t.nombre_sucursal, apertura: t.fecha_hora_apertura, fondo_inicial: t.monto_inicial,
                    ventas: t.ventas, total: t.total, efectivo_cobrado: t.efectivo,
                    efectivo_esperado: Number(t.monto_inicial) + Number(t.efectivo) }))
            };
        }
    };

    h.ayuda_sistema = {
        descripcion: 'Guía paso a paso para usar una parte del sistema. Úsala para preguntas de "cómo hago…".',
        parametros: { type: 'object', required: ['tema'], properties: {
            tema: { type: 'string', enum: guias.map(g => g.clave) }
        }},
        ejecutar: async ({ tema } = {}) => {
            const g = guias.find(x => x.clave === tema);
            if (!g) throw errorPublico('Ese tema no está disponible para tu rol');
            return { tema: g.titulo, guia: g.texto };
        }
    };

    return h;
};

const responder = async (usuario, mensajes) => {
    const esAdmin = Number(usuario.id_rol) === 1;
    const [p, permisos, perfil] = await Promise.all([
        ajusteModel.parametros(),
        permisoModel.obtenerPermisosEfectivos(usuario.id_usuario, usuario.id_rol),
        userModel.obtenerPerfil(usuario.id_usuario)
    ]);
    const guias = guiasPermitidas(esAdmin, permisos);
    const herramientas = crearHerramientas({ usuario, esAdmin, permisos, guias });

    const sistema = `Eres el asistente interno del sistema de ventas e inventario de "${p.nombre_comercial}". Ayudas al personal con datos del negocio y con el uso del sistema.

REGLAS:
- Responde siempre en español, claro y breve. Usa listas cortas cuando ayuden.
- Para cualquier cifra (ventas, stock, caja, pedidos) usa las funciones. Nunca inventes ni estimes datos: si una función no trae el dato, dilo.
- Antes de explicar cómo hacer algo en el sistema llama SIEMPRE a ayuda_sistema y usa solo los pasos y nombres de botones de esa guía; nunca describas pantallas o botones de memoria.
- Eres de solo lectura: no puedes registrar ventas, cambiar stock, cobrar ni modificar nada. Si te lo piden, dilo y explica cómo hacerlo con la guía de ayuda_sistema.
- Si piden algo para lo que no tienes función, el rol del usuario no tiene acceso a esa información: dilo con amabilidad y sugiere pedírsela al administrador (no lo mandes a otra pantalla).
- Métodos de pago habilitados: ${[p.pago_efectivo && METODO_PAGO.efectivo, p.pago_qr && METODO_PAGO.qr].filter(Boolean).join(' y ')} (no hay otros).
- Montos en ${p.moneda_simbolo} con dos decimales. Fechas en formato día/mes/año al responder.
- No menciones al usuario los nombres internos de las funciones.
- Si piden dejar el stock en una cantidad exacta y puedes consultar el stock, consúltalo y di cuánto registrar (la diferencia) como Entrada o Merma.
- Formato: texto simple; puedes usar **negrita** y listas con "- ".

MAPA DEL SISTEMA (menú lateral; los pasos completos están en ayuda_sistema):
${guias.map(g => `- ${g.titulo}: ${g.resumen}`).join('\n')}

USUARIO: ${perfil?.nombre_completo || 'Usuario'} (${esAdmin ? 'Administrador, puede ver todas las sucursales' : `Cajero de ${perfil?.nombre_sucursal || 'su sucursal'}, solo ve su sucursal`}).
Hoy es ${new Date().toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${hoyLaPaz()}).`;

    return groq.conversar({ perfil: 'interno', sistema, mensajes, herramientas, maxTokens: 900 });
};

module.exports = { responder, crearHerramientas };
