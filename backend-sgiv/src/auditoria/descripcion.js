// ─── Auditoría legible: cada operación (petición o proceso) como una frase ───
// Una operación agrupa todas las filas que cambió una misma petición a la API
// (o una misma transacción hecha por el sistema o directamente en la BD).

// ─── Módulos (filtro y etiqueta) ───
// rutas: prefijos de la API; tablas: para lo que no viene de la API (procesos, BD directa)
const MODULOS = [
    { id: 'ventas',      nombre: 'Ventas y caja', rutas: ['/caja'],                  tablas: ['venta_caja', 'detalle_venta', 'turno_caja'] },
    { id: 'mesas',       nombre: 'Mesas',         rutas: ['/cuentas', '/mesas'],     tablas: ['cuenta_mesa', 'detalle_cuenta', 'mesa_local'] },
    { id: 'pedidos',     nombre: 'Pedidos QR',    rutas: ['/pedidos', '/menu'],      tablas: ['pedido_mesa', 'detalle_pedido', 'bloqueo_menu'] },
    { id: 'inventario',  nombre: 'Inventario',    rutas: ['/inventario'],            tablas: ['inventario_sucursal', 'historial_inventario', 'lote_inventario', 'movimiento_lote', 'transferencia', 'detalle_transferencia'] },
    { id: 'productos',   nombre: 'Productos',     rutas: ['/catalogo'],              tablas: ['producto', 'categoria_producto'] },
    { id: 'promociones', nombre: 'Promociones',   rutas: ['/promociones'],           tablas: ['promocion', 'promocion_producto', 'promocion_categoria', 'promocion_dia'] },
    { id: 'usuarios',    nombre: 'Usuarios',      rutas: ['/usuarios', '/permisos'], tablas: ['usuario', 'permiso_usuario', 'rol_usuario'] },
    { id: 'costos',      nombre: 'Costos',        rutas: ['/costos'],                tablas: ['insumo', 'historial_precio_insumo', 'receta', 'ingrediente_receta', 'historial_inversion_receta', 'unidad_medida'] },
    { id: 'ajustes',     nombre: 'Ajustes',       rutas: ['/ajustes', '/sucursales'], tablas: ['configuracion', 'sucursal', 'horario_sucursal', 'propietario'] }
];

// ─── Nombres de tablas: [singular, plural] ───
const TABLAS = {
    venta_caja: ['venta', 'ventas'], detalle_venta: ['línea de venta', 'líneas de venta'],
    turno_caja: ['turno de caja', 'turnos de caja'],
    cuenta_mesa: ['cuenta de mesa', 'cuentas de mesa'], detalle_cuenta: ['producto de mesa', 'productos de mesa'],
    mesa_local: ['mesa', 'mesas'],
    pedido_mesa: ['pedido QR', 'pedidos QR'], detalle_pedido: ['producto de pedido', 'productos de pedido'],
    bloqueo_menu: ['bloqueo del menú', 'bloqueos del menú'],
    inventario_sucursal: ['existencia', 'existencias'], historial_inventario: ['movimiento de stock', 'movimientos de stock'],
    lote_inventario: ['lote', 'lotes'], movimiento_lote: ['movimiento de lote', 'movimientos de lote'],
    transferencia: ['transferencia', 'transferencias'], detalle_transferencia: ['producto transferido', 'productos transferidos'],
    producto: ['producto', 'productos'], categoria_producto: ['categoría', 'categorías'],
    promocion: ['promoción', 'promociones'], promocion_producto: ['producto en promoción', 'productos en promoción'],
    promocion_categoria: ['categoría en promoción', 'categorías en promoción'],
    promocion_dia: ['día de promoción', 'días de promoción'],
    usuario: ['usuario', 'usuarios'], permiso_usuario: ['permiso', 'permisos'], rol_usuario: ['rol', 'roles'],
    insumo: ['insumo', 'insumos'], historial_precio_insumo: ['precio de insumo', 'precios de insumo'],
    receta: ['receta', 'recetas'], ingrediente_receta: ['ingrediente', 'ingredientes'],
    historial_inversion_receta: ['cálculo de receta', 'cálculos de receta'], unidad_medida: ['unidad de medida', 'unidades de medida'],
    configuracion: ['configuración', 'configuraciones'], sucursal: ['sucursal', 'sucursales'],
    horario_sucursal: ['horario', 'horarios'], propietario: ['propietario', 'propietarios']
};

const nombreTabla = (t, n = 1) => (TABLAS[t] || [t.replace(/_/g, ' '), t.replace(/_/g, ' ')])[n === 1 ? 0 : 1];

// ─── Nombres de campos ───
const CAMPOS = {
    nombre_producto: 'Nombre', precio_unitario: 'Precio', descripcion_producto: 'Descripción', url_imagen: 'Foto',
    mostrar_en_menu: 'Visible en el menú', estado_activo: 'Activo', destacado: 'Recomendado', id_categoria: 'Categoría',
    nombre_categoria: 'Categoría', descripcion_categoria: 'Descripción', orden: 'Orden',
    cantidad_actual: 'Stock', cantidad_movida: 'Cantidad', tipo_movimiento: 'Tipo', motivo_movimiento: 'Motivo',
    stock_resultante: 'Stock resultante', id_inventario: 'Producto',
    tipo_producto: 'Tipo de producto', vida_util_horas: 'Vida útil (h)', fecha_ingreso: 'Ingreso', fecha_vencimiento: 'Vence',
    cantidad_inicial: 'Cantidad que entró', vida_util_elaborado_horas: 'Vida útil de lo elaborado (h)',
    vida_util_comprado_dias: 'Vida útil de lo comprado (días)',
    monto_total_venta: 'Total', metodo_pago: 'Método de pago', descuento_promociones: 'Descuento por promoción',
    descuento_manual: 'Descuento manual', motivo_descuento: 'Motivo del descuento', cantidad_vendida: 'Cantidad',
    subtotal_venta: 'Subtotal', descuento_promocion: 'Descuento por promoción', id_promocion: 'Promoción',
    monto_inicial: 'Fondo inicial', monto_calculado: 'Efectivo esperado', monto_real_declarado: 'Efectivo declarado',
    diferencia: 'Diferencia', estado_turno: 'Estado', cerrado_por: 'Cerrado por',
    fecha_hora_apertura: 'Apertura', fecha_hora_cierre: 'Cierre',
    numero_mesa: 'Número de mesa', estado_mesa: 'Estado', codigo_qr: 'Código QR', codigo_visita: 'Código de visita',
    fecha_habilitacion: 'Habilitada', fecha_liberacion: 'Liberada', estado: 'Estado', fecha_apertura: 'Apertura', fecha_cierre: 'Cierre',
    cantidad: 'Cantidad', nota: 'Nota', origen: 'Origen', id_venta: 'Venta', cliente_mesa: 'Celular del cliente', nombre_cliente: 'Cliente',
    estado_pedido: 'Estado', tipo_pedido: 'Tipo', cantidad_solicitada: 'Cantidad', precio_aplicado: 'Precio', nota_cliente: 'Nota',
    observacion_general: 'Observación', ip_cliente: 'IP del cliente', sin_verificar: 'Sin verificar', bloqueado_hasta: 'Bloqueado hasta',
    nombre_completo: 'Nombre', correo_electronico: 'Correo', contrasena_hash: 'Contraseña', id_rol: 'Rol', telefono: 'Teléfono',
    telegram_chat_id: 'Telegram', avisos_telegram: 'Avisos por Telegram', avisos_sucursal: 'Avisos de', modulo: 'Módulo', tiene_acceso: 'Acceso',
    nombre_sucursal: 'Nombre', direccion_fisica: 'Dirección', telefono_contacto: 'Teléfono', dia_semana: 'Día', dia: 'Día',
    abierto: 'Abierto', hora_apertura: 'Apertura', hora_cierre: 'Cierre',
    id_sucursal: 'Sucursal', id_sucursal_origen: 'Origen', id_sucursal_destino: 'Destino', observacion: 'Observación',
    id_usuario: 'Usuario', id_usuario_cajero: 'Cajero', id_usuario_apertura: 'Abierta por', id_usuario_atencion: 'Atendido por',
    id_usuario_creador: 'Creada por', id_producto: 'Producto', id_mesa: 'Mesa', id_cuenta: 'Cuenta', id_pedido: 'Pedido', id_turno: 'Turno',
    nombre: 'Nombre', tipo: 'Tipo', valor: 'Valor', lleva: 'Lleva', paga: 'Paga', fecha_inicio: 'Desde', fecha_fin: 'Hasta',
    dias_semana: 'Días', hora_inicio: 'Hora de inicio', hora_fin: 'Hora de fin',
    cantidad_compra: 'Cantidad de compra', id_unidad_compra: 'Unidad de compra', precio_compra: 'Precio de compra',
    rendimiento: 'Rendimiento', inversion: 'Inversión', id_unidad: 'Unidad', motivo: 'Motivo',
    porcentaje_participacion: 'Participación (%)', ci: 'CI', cargo: 'Cargo', correo: 'Correo',
    detalle: 'Detalle', fecha_registro: 'Registro', fecha_venta: 'Fecha', fecha_pedido: 'Fecha',
    // Ajustes
    nombre_comercial: 'Nombre comercial', razon_social: 'Razón social', nit: 'NIT', login_titulo: 'Texto del inicio de sesión',
    whatsapp: 'WhatsApp', sitio_web: 'Sitio web', direccion: 'Dirección', pais: 'País', tiktok: 'TikTok',
    url_logo: 'Logo', url_favicon: 'Ícono', color_primario: 'Color principal', color_secundario: 'Color secundario', tema: 'Tema',
    moneda_simbolo: 'Moneda', pago_efectivo: 'Pago en efectivo', pago_qr: 'Pago con QR', url_qr_cobro: 'QR de cobro',
    ticket_mensaje_pie: 'Pie del ticket', ticket_ancho: 'Ancho del ticket', menu_activo: 'Menú QR activo',
    menu_mensaje_bienvenida: 'Bienvenida del menú', menu_minutos_expiracion: 'Vencimiento de pedidos (min)',
    menu_max_pendientes_mesa: 'Pendientes por mesa', menu_max_pedidos_ip: 'Pedidos por IP',
    menu_visita_horas: 'Duración de la visita (h)', menu_visita_inactividad: 'Inactividad de la visita (min)',
    menu_bloqueo_horas: 'Bloqueo por pedido falso (h)', menu_qr_visita: 'QR por visita', stock_minimo_defecto: 'Stock mínimo',
    captcha_activo: 'CAPTCHA', login_max_intentos: 'Intentos de ingreso', login_minutos_bloqueo: 'Bloqueo de ingreso (min)',
    sesion_horas: 'Duración de la sesión (h)', ia_info_negocio: 'Información para el chatbot'
};

const nombreCampo = (c) => CAMPOS[c] || (c.charAt(0).toUpperCase() + c.slice(1)).replace(/_/g, ' ');

// Campos que identifican a otra entidad: se muestran con su nombre
const REFERENCIAS = {
    id_producto: 'producto', id_inventario: 'inventario', id_categoria: 'categoria', id_mesa: 'mesa', id_cuenta: 'cuenta',
    id_sucursal: 'sucursal', id_sucursal_origen: 'sucursal', id_sucursal_destino: 'sucursal', avisos_sucursal: 'sucursal',
    id_usuario: 'usuario', id_usuario_cajero: 'usuario', id_usuario_apertura: 'usuario', id_usuario_atencion: 'usuario',
    id_usuario_creador: 'usuario', id_rol: 'rol'
};

// ─── Formato de valores ───
const FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Montos: siempre con dos decimales
const ES_MONTO = /precio|monto|descuento|subtotal|inversion|diferencia/;

/** Fecha guardada en JSON (con o sin zona) → dd/mm/aaaa hh:mm en hora de Bolivia */
const fechaTexto = (v) => {
    if (/[+-]\d{2}:\d{2}$|Z$/.test(v)) {
        const d = new Date(v);
        if (!isNaN(d)) {
            const p = Object.fromEntries(new Intl.DateTimeFormat('es-BO', {
                timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
            }).formatToParts(d).map(x => [x.type, x.value]));
            return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
        }
    }
    const m = FECHA_HORA.exec(v);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : v;
};

const valorTexto = (campo, v, nombres) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (typeof v === 'object') return JSON.stringify(v);
    if (campo === 'telegram_chat_id') return 'Vinculado';
    const ref = REFERENCIAS[campo];
    if (ref) return nombres.de(ref, v) || `#${v}`;
    if (typeof v === 'number' && ES_MONTO.test(campo)) return v.toFixed(2);
    const s = String(v);
    if (SOLO_FECHA.test(s)) return s.split('-').reverse().join('/');
    if (FECHA_HORA.test(s)) return fechaTexto(s);
    return s.length > 300 ? s.slice(0, 300) + '…' : s;
};

// ─── Rutas de la API ───
const ES_API = /^([A-Z]+) \/api(\/\S*)$/;

/** 'POST /api/mesas/5/liberar' → { metodo, ruta: '/mesas/:id/liberar', ids: [5] } */
const leerOrigen = (origen) => {
    const m = ES_API.exec(origen || '');
    if (!m) return null;
    const ids = [];
    const ruta = m[2]
        .replace(/^\/menu\/m\/[^/]+/, '/menu/m/:codigo')
        .replace(/\/(\d+)(?=\/|$)/g, (_, n) => { ids.push(Number(n)); return '/:id'; });
    return { metodo: m[1], ruta, ids };
};

const moduloDeRuta = (ruta) => MODULOS.find(m => m.rutas.some(r => ruta === r || ruta.startsWith(r + '/')));

const moduloDeTablas = (tablas) => MODULOS.find(m => tablas.some(t => m.tablas.includes(t)));

// ─── Catálogo de operaciones ───
// tipo: crear | modificar | eliminar (filtro «Acción»)
// texto(c) → [acción, detalle]
const OPERACIONES = {};
const op = (clave, tipo, texto) => { OPERACIONES[clave] = { tipo, texto }; };

const conDetalle = (...partes) => partes.filter(Boolean).join(' · ');

// Ventas y caja
op('POST /caja/cobrar', 'crear', (c) => {
    const v = c.fila('venta_caja', 'INSERT')?.nuevo;
    if (!v) return ['Registró una venta'];
    return ['Registró una venta', conDetalle(`Venta #${v.numero_dia ?? v.id_venta}`, c.dinero(v.monto_total_venta), v.metodo_pago,
        Number(v.descuento_manual) > 0 && `Descuento manual ${c.dinero(v.descuento_manual)} (${v.motivo_descuento || 'sin motivo'})`)];
});
op('POST /caja/turnos/abrir', 'crear', (c) => {
    const t = c.fila('turno_caja', 'INSERT')?.nuevo;
    return ['Abrió caja', t && conDetalle(`Fondo inicial ${c.dinero(t.monto_inicial)}`, c.nombre('sucursal', t.id_sucursal))];
});
op('POST /caja/cerrar', 'modificar', (c) => {
    const t = c.fila('turno_caja', 'UPDATE')?.nuevo;
    return ['Cerró caja', t && cierreTexto(c, t)];
});
op('POST /caja/reabrir/:id', 'modificar', (c) => ['Reabrió una caja', `Caja de ${c.nombre('usuario', c.ids[0])}`]);
op('PATCH /caja/habilitar/:id', 'modificar', (c) => ['Habilitó una caja', `Caja de ${c.nombre('usuario', c.ids[0])}`]);
op('PATCH /caja/deshabilitar/:id', 'modificar', (c) => {
    const t = c.fila('turno_caja', 'UPDATE')?.nuevo;
    return ['Cerró la caja de otra persona', conDetalle(`Caja de ${c.nombre('usuario', c.ids[0])}`, t && cierreTexto(c, t))];
});

function cierreTexto(c, t) {
    if (t.monto_real_declarado == null) return `Esperado ${c.dinero(t.monto_calculado)}`;
    const dif = Number(t.monto_real_declarado) - Number(t.monto_calculado);
    return conDetalle(`Declaró ${c.dinero(t.monto_real_declarado)}`, `esperado ${c.dinero(t.monto_calculado)}`,
        Math.abs(dif) >= 0.005 ? `diferencia ${dif > 0 ? '+' : '−'}${c.dinero(Math.abs(dif))}` : 'sin diferencia');
}

// Mesas
const mesaDeCuenta = (c, id_cuenta) => c.nombre('cuenta', id_cuenta);
const lineaProducto = (c, d) => d && `${c.nombre('producto', d.id_producto)} × ${d.cantidad}`;

op('POST /cuentas/abrir', 'crear', (c) => {
    const cu = c.fila('cuenta_mesa', 'INSERT')?.nuevo;
    return ['Abrió una cuenta', cu && c.nombre('mesa', cu.id_mesa)];
});
op('POST /cuentas/:id/producto', 'crear', (c) => {
    const d = c.fila('detalle_cuenta', 'INSERT') || c.fila('detalle_cuenta', 'UPDATE');
    const cant = d?.operacion === 'UPDATE' ? Number(d.nuevo.cantidad) - Number(d.anterior.cantidad) : d?.nuevo.cantidad;
    return ['Agregó un producto a una mesa', conDetalle(mesaDeCuenta(c, c.ids[0]),
        d && `${c.nombre('producto', d.nuevo.id_producto)} × ${cant}`)];
});
op('DELETE /cuentas/detalle/:id', 'eliminar', (c) => {
    const d = c.fila('detalle_cuenta', 'DELETE')?.anterior;
    return ['Quitó un producto de una mesa', conDetalle(d && mesaDeCuenta(c, d.id_cuenta), lineaProducto(c, d))];
});
op('PATCH /cuentas/detalle/:id', 'modificar', (c) => {
    const d = c.fila('detalle_cuenta', 'UPDATE');
    return ['Cambió una cantidad en una mesa', d && conDetalle(mesaDeCuenta(c, d.nuevo.id_cuenta),
        `${c.nombre('producto', d.nuevo.id_producto)}: ${d.anterior.cantidad} → ${d.nuevo.cantidad}`)];
});
op('POST /cuentas/:id/cerrar', 'crear', (c) => {
    const v = c.fila('venta_caja', 'INSERT')?.nuevo;
    return ['Cobró una mesa', conDetalle(mesaDeCuenta(c, c.ids[0]),
        v && `Venta #${v.numero_dia ?? v.id_venta}`, v && c.dinero(v.monto_total_venta), v?.metodo_pago,
        v && Number(v.descuento_manual) > 0 && `Descuento manual ${c.dinero(v.descuento_manual)} (${v.motivo_descuento || 'sin motivo'})`)];
});
op('POST /cuentas/:id/cancelar-si-vacia', 'modificar', (c) => ['Cerró una cuenta vacía', mesaDeCuenta(c, c.ids[0])]);
op('POST /cuentas/reset-mesa', 'modificar', (c) => {
    const cu = c.fila('cuenta_mesa', 'UPDATE') || c.fila('cuenta_mesa', 'DELETE');
    const m = c.fila('mesa_local', 'UPDATE');
    return ['Reinició una mesa', c.nombre('mesa', m?.nuevo.id_mesa ?? cu?.nuevo?.id_mesa ?? cu?.anterior?.id_mesa)];
});
op('POST /mesas', 'crear', (c) => {
    const m = c.fila('mesa_local', 'INSERT')?.nuevo;
    return ['Agregó una mesa', m && conDetalle(`Mesa ${m.numero_mesa}`, c.nombre('sucursal', m.id_sucursal))];
});
op('DELETE /mesas/:id', 'eliminar', (c) => {
    const m = c.fila('mesa_local', 'DELETE')?.anterior;
    return ['Eliminó una mesa', m && conDetalle(`Mesa ${m.numero_mesa}`, c.nombre('sucursal', m.id_sucursal))];
});
op('POST /mesas/:id/qr/regenerar', 'modificar', (c) => ['Generó un QR nuevo', c.nombre('mesa', c.ids[0])]);
op('POST /mesas/:id/habilitar',     'modificar', (c) => ['Habilitó una mesa', c.nombre('mesa', c.ids[0])]);
op('POST /mesas/:id/liberar',       'modificar', (c) => ['Liberó una mesa', c.nombre('mesa', c.ids[0])]);

// Pedidos QR
const pedidoTexto = (c, p) => p && conDetalle(`Pedido #${p.numero_dia ?? p.id_pedido}`, c.nombre('mesa', p.id_mesa), p.nombre_cliente);

op('POST /menu/m/:codigo/pedidos', 'crear', (c) => {
    const p = c.fila('pedido_mesa', 'INSERT')?.nuevo;
    const n = c.cuenta('detalle_pedido', 'INSERT');
    return ['Hizo un pedido desde el menú QR', conDetalle(pedidoTexto(c, p), n && `${n} ${n === 1 ? 'producto' : 'productos'}`)];
});
op('POST /menu/m/:codigo/pedidos/:id/cancelar', 'modificar', (c) =>
    ['Canceló su pedido desde el menú QR', pedidoTexto(c, c.fila('pedido_mesa', 'UPDATE')?.nuevo) || `Pedido #${c.ids[0]}`]);
op('POST /pedidos/:id/confirmar', 'modificar', (c) =>
    ['Confirmó un pedido QR', pedidoTexto(c, c.fila('pedido_mesa', 'UPDATE')?.nuevo) || `Pedido #${c.ids[0]}`]);
op('POST /pedidos/:id/rechazar', 'modificar', (c) => [
    c.fila('bloqueo_menu', 'INSERT') ? 'Marcó un pedido QR como falso' : 'Rechazó un pedido QR',
    pedidoTexto(c, c.fila('pedido_mesa', 'UPDATE')?.nuevo) || `Pedido #${c.ids[0]}`]);
op('POST /pedidos/:id/entregado', 'modificar', (c) =>
    ['Entregó un pedido QR', pedidoTexto(c, c.fila('pedido_mesa', 'UPDATE')?.nuevo) || `Pedido #${c.ids[0]}`]);
op('PATCH /pedidos/:id/detalle/:id', 'modificar', (c) => {
    const d = c.fila('detalle_pedido', 'UPDATE') || c.fila('detalle_pedido', 'DELETE');
    return ['Modificó un pedido QR', conDetalle(`Pedido #${c.ids[0]}`, d && (d.nuevo
        ? `${c.nombre('producto', d.nuevo.id_producto)}: ${d.anterior.cantidad_solicitada} → ${d.nuevo.cantidad_solicitada}`
        : `Quitó ${c.nombre('producto', d.anterior.id_producto)}`))];
});

// Inventario
op('POST /inventario/movimientos', 'crear', (c) => {
    const h = c.fila('historial_inventario', 'INSERT')?.nuevo;
    if (!h) return ['Registró un movimiento de stock'];
    return [h.tipo_movimiento === 'INGRESO' ? 'Registró un ingreso de stock' : 'Registró una salida de stock',
        conDetalle(`${c.nombre('inventario', h.id_inventario)} × ${h.cantidad_movida}`, h.motivo_movimiento,
            c.sucursalDeInventario(h.id_inventario), `stock ${h.stock_resultante}`)];
});
op('POST /inventario/vencidos/baja', 'eliminar', (c) => {
    const h = c.fila('historial_inventario', 'INSERT')?.nuevo;
    const n = c.cuenta('historial_inventario', 'INSERT');
    return ['Dio de baja productos vencidos', h && conDetalle(`${n} ${n === 1 ? 'lote' : 'lotes'}`,
        c.sucursalDeInventario(h.id_inventario))];
});
op('POST /inventario/transferencias', 'crear', (c) => {
    const t = c.fila('transferencia', 'INSERT')?.nuevo;
    const n = c.cuenta('detalle_transferencia', 'INSERT');
    return ['Transfirió productos', t && conDetalle(`Transferencia #${t.id_transferencia}`,
        `${c.nombre('sucursal', t.id_sucursal_origen)} → ${c.nombre('sucursal', t.id_sucursal_destino)}`,
        `${n} ${n === 1 ? 'producto' : 'productos'}`)];
});

// Productos y categorías
const productoDe = (c) => {
    const f = c.fila('producto');
    return f && (f.nuevo || f.anterior);
};

op('POST /catalogo/productos', 'crear', (c) => {
    const p = c.fila('producto', 'INSERT')?.nuevo;
    return ['Creó un producto', p && conDetalle(p.nombre_producto, c.dinero(p.precio_unitario))];
});
op('PUT /catalogo/productos/:id', 'modificar', (c) => {
    const f = c.fila('producto', 'UPDATE');
    return ['Modificó un producto', f ? conDetalle(f.nuevo.nombre_producto, c.cambiosTexto(f)) : c.nombre('producto', c.ids[0])];
});
op('DELETE /catalogo/productos/:id', 'eliminar', (c) => [
    c.fila('producto', 'DELETE') ? 'Eliminó un producto' : 'Desactivó un producto',
    productoDe(c)?.nombre_producto || c.nombre('producto', c.ids[0])]);
op('PATCH /catalogo/productos/:id/reactivar', 'modificar', (c) =>
    ['Reactivó un producto', productoDe(c)?.nombre_producto || c.nombre('producto', c.ids[0])]);
op('POST /catalogo/categorias', 'crear', (c) =>
    ['Creó una categoría', c.fila('categoria_producto', 'INSERT')?.nuevo.nombre_categoria]);
op('DELETE /catalogo/categorias/:id', 'eliminar', (c) =>
    ['Eliminó una categoría', c.fila('categoria_producto', 'DELETE')?.anterior.nombre_categoria || c.nombre('categoria', c.ids[0])]);
op('PUT /catalogo/categorias/orden', 'modificar', () => ['Ordenó las categorías del menú']);

// Promociones
const promo = (c) => { const f = c.fila('promocion'); return (f?.nuevo || f?.anterior)?.nombre; };
op('POST /promociones',            'crear',     (c) => ['Creó una promoción', promo(c)]);
op('PUT /promociones/:id',         'modificar', (c) => ['Modificó una promoción', conDetalle(promo(c), c.cambiosTexto(c.fila('promocion', 'UPDATE')))]);
op('PATCH /promociones/:id/estado', 'modificar', (c) => {
    const f = c.fila('promocion', 'UPDATE')?.nuevo;
    return [f && !f.estado_activo ? 'Pausó una promoción' : 'Activó una promoción', promo(c)];
});
op('DELETE /promociones/:id',      'eliminar',  (c) => ['Eliminó una promoción', promo(c)]);

// Usuarios
const usuarioDe = (c) => { const f = c.fila('usuario'); return (f?.nuevo || f?.anterior)?.nombre_completo || c.nombre('usuario', c.ids[0]); };
op('POST /usuarios/registro', 'crear', (c) => {
    const u = c.fila('usuario', 'INSERT')?.nuevo;
    return ['Registró un usuario', u && conDetalle(u.nombre_completo, c.nombre('rol', u.id_rol), c.nombre('sucursal', u.id_sucursal))];
});
op('PUT /usuarios/:id',              'modificar', (c) => ['Modificó un usuario', conDetalle(usuarioDe(c), c.cambiosTexto(c.fila('usuario', 'UPDATE')))]);
op('PATCH /usuarios/:id/desactivar', 'eliminar',  (c) => ['Desactivó un usuario', usuarioDe(c)]);
op('PATCH /usuarios/:id/reactivar',  'modificar', (c) => ['Reactivó un usuario', usuarioDe(c)]);
op('PATCH /usuarios/:id/contrasena', 'modificar', (c) => ['Cambió una contraseña', usuarioDe(c)]);
op('PUT /permisos/usuario/:id', 'modificar', (c) => {
    const dados = c.filas('permiso_usuario').filter(f => f.nuevo?.tiene_acceso && !f.anterior?.tiene_acceso).map(f => f.nuevo.modulo);
    const quitados = c.filas('permiso_usuario').filter(f => f.anterior?.tiene_acceso && !f.nuevo?.tiene_acceso).map(f => f.anterior.modulo);
    return ['Cambió permisos', conDetalle(c.nombre('usuario', c.ids[0]),
        dados.length && `Dio: ${dados.join(', ').replace(/_/g, ' ')}`, quitados.length && `Quitó: ${quitados.join(', ').replace(/_/g, ' ')}`)];
});

// Ajustes
const configuracion = (c) => c.cambiosTexto(c.fila('configuracion', 'UPDATE'));
op('PUT /ajustes/empresa',    'modificar', (c) => ['Modificó los datos de la empresa', configuracion(c)]);
op('PUT /ajustes/apariencia', 'modificar', (c) => ['Modificó la apariencia', configuracion(c)]);
op('PUT /ajustes/parametros', 'modificar', (c) => ['Modificó los parámetros', configuracion(c)]);
op('PUT /ajustes/ia',         'modificar', () => ['Modificó la información del chatbot']);
op('PUT /ajustes/telegram/usuarios/:id', 'modificar', (c) =>
    ['Cambió el Telegram de un usuario', conDetalle(usuarioDe(c), c.cambiosTexto(c.fila('usuario', 'UPDATE')))]);
op('POST /ajustes/telegram/usuarios/:id/desvincular', 'modificar', (c) => ['Desvinculó un Telegram', usuarioDe(c)]);
const propietario = (c) => { const f = c.fila('propietario'); return (f?.nuevo || f?.anterior)?.nombre_completo; };
op('POST /ajustes/propietarios',       'crear',     (c) => ['Registró un propietario', propietario(c)]);
op('PUT /ajustes/propietarios/:id',    'modificar', (c) => ['Modificó un propietario', conDetalle(propietario(c), c.cambiosTexto(c.fila('propietario', 'UPDATE')))]);
op('DELETE /ajustes/propietarios/:id', 'eliminar',  (c) => ['Eliminó un propietario', propietario(c)]);
const sucursal = (c) => { const f = c.fila('sucursal'); return (f?.nuevo || f?.anterior)?.nombre_sucursal || c.nombre('sucursal', c.ids[0]); };
op('POST /sucursales',            'crear',     (c) => ['Creó una sucursal', sucursal(c)]);
op('PUT /sucursales/:id',         'modificar', (c) => ['Modificó una sucursal', sucursal(c)]);
op('PATCH /sucursales/:id/estado', 'modificar', (c) => {
    const f = c.fila('sucursal', 'UPDATE')?.nuevo;
    return [f && !f.estado_activo ? 'Desactivó una sucursal' : 'Activó una sucursal', sucursal(c)];
});

// Costos
const insumo = (c) => { const f = c.fila('insumo'); return (f?.nuevo || f?.anterior)?.nombre; };
const receta = (c) => { const f = c.fila('receta'); return (f?.nuevo || f?.anterior)?.nombre; };
const recalculadas = (c, excluir = 0) => {
    const n = c.cuenta('receta', 'UPDATE') - excluir;
    return n > 0 && `recalculó ${n} ${n === 1 ? 'receta' : 'recetas'}`;
};
op('POST /costos/insumos',       'crear',     (c) => ['Registró un insumo', insumo(c)]);
op('PUT /costos/insumos/:id',    'modificar', (c) => ['Modificó un insumo', conDetalle(insumo(c), c.cambiosTexto(c.fila('insumo', 'UPDATE')), recalculadas(c))]);
op('DELETE /costos/insumos/:id', 'eliminar',  (c) => ['Eliminó un insumo', insumo(c)]);
op('POST /costos/recetas',       'crear',     (c) => ['Creó una receta', receta(c)]);
op('PUT /costos/recetas/:id',    'modificar', (c) => ['Modificó una receta', receta(c)]);
op('DELETE /costos/recetas/:id', 'eliminar',  (c) => ['Eliminó una receta', receta(c)]);

// Expresión regular de cada ruta del catálogo (para filtrar en la BD por registro_cambio.origen)
const regexRuta = (clave) => {
    const [metodo, ruta] = clave.split(' ');
    return `^${metodo} /api${ruta.replace(/:codigo/g, '[^/]+').replace(/:id/g, '[0-9]+')}$`;
};

const VERBO_SQL = { crear: ['INSERT'], modificar: ['UPDATE'], eliminar: ['DELETE', 'TRUNCATE'] };

/** Filtro «Acción» → regex de rutas + operaciones SQL (para lo que no viene de la API) */
const filtroAccion = (tipo) => {
    if (!VERBO_SQL[tipo]) return null;
    const rutas = Object.entries(OPERACIONES).filter(([, o]) => o.tipo === tipo).map(([k]) => regexRuta(k));
    if (tipo === 'eliminar') rutas.push('^DELETE /api/');
    return { regex: rutas.join('|'), operaciones: VERBO_SQL[tipo] };
};

/** Filtro «Módulo» → regex de prefijos + tablas (para lo que no viene de la API) */
const filtroModulo = (id) => {
    const m = MODULOS.find(x => x.id === id);
    if (!m) return null;
    return { regex: m.rutas.map(r => `^[A-Z]+ /api${r}(/|$)`).join('|'), tablas: m.tablas };
};

// ─── Procesos sin petición ───
const PROCESOS = [
    { patron: /^Proceso automático: cierre del día/, texto: (c) => {
        const n = c.cuenta('turno_caja', 'UPDATE');
        return ['Cierre automático del día', n ? (n === 1 ? 'Cerró 1 caja que quedó abierta' : `Cerró ${n} cajas que quedaron abiertas`) : null];
    } },
    { patron: /^Proceso automático: vencimiento/, texto: (c) => {
        const p = c.cuenta('pedido_mesa', 'UPDATE'), m = c.cuenta('mesa_local', 'UPDATE');
        return ['Vencimiento automático', conDetalle(p && `${p} ${p === 1 ? 'pedido vencido' : 'pedidos vencidos'}`,
            m && `${m} ${m === 1 ? 'mesa liberada' : 'mesas liberadas'}`)];
    } },
    { patron: /^Bot de Telegram/, texto: (c) => {
        const u = c.fila('usuario', 'UPDATE')?.nuevo;
        return [u?.telegram_chat_id ? 'Vinculó su Telegram' : 'Actualizó un Telegram', u?.nombre_completo];
    } },
    { patron: /^Directo en la BD/, texto: (c) => ['Cambio directo en la base de datos', conDetalle(c.resumen(), c.origen.replace(/^Directo en la BD\s*/, '').replace(/^\((.*)\)$/, '$1'))] }
];

// ─── Descripción de una operación ───
/**
 * op: { origen, filas: [{ tabla, operacion, n, nuevo, anterior, campos }] }
 * nombres: { de(tipo, id) }, moneda: 'Bs.'
 */
const describir = (op, nombres, moneda) => {
    const filas = op.filas;
    const c = {
        origen: op.origen || '',
        ids: [],
        fila:  (tabla, operacion) => filas.find(f => f.tabla === tabla && (!operacion || f.operacion === operacion)) || null,
        filas: (tabla) => filas.filter(f => f.tabla === tabla).flatMap(f => f.todas || [f]),
        cuenta: (tabla, operacion) => filas.filter(f => f.tabla === tabla && (!operacion || f.operacion === operacion))
                                           .reduce((s, f) => s + f.n, 0),
        nombre: (tipo, id) => id == null ? null : (nombres.de(tipo, id) || `#${id}`),
        sucursalDeInventario: (id) => nombres.de('inventario_sucursal', id),
        dinero: (v) => `${moneda} ${Number(v || 0).toFixed(2)}`,
        cambiosTexto: (f) => cambiosTexto(f, nombres, moneda),
        resumen: () => resumen(filas)
    };

    const ruta = leerOrigen(op.origen);
    let modulo, tipo, accion, detalle;
    if (ruta) {
        c.ids = ruta.ids;
        const def = OPERACIONES[`${ruta.metodo} ${ruta.ruta}`];
        modulo = moduloDeRuta(ruta.ruta) || moduloDeTablas(filas.map(f => f.tabla));
        if (def) {
            tipo = def.tipo;
            try { [accion, detalle] = def.texto(c); } catch { /* datos incompletos: se usa el resumen */ }
        } else if (ruta.metodo === 'DELETE') tipo = 'eliminar';
    } else {
        const proc = PROCESOS.find(p => p.patron.test(c.origen));
        modulo = moduloDeTablas(filas.map(f => f.tabla));
        if (proc) {
            try { [accion, detalle] = proc.texto(c); } catch { /* idem */ }
        } else {
            accion = c.origen || 'Proceso del sistema';
        }
    }
    if (!tipo) tipo = tipoPorFilas(filas);
    return {
        modulo: modulo?.nombre || 'Sistema',
        tipo,
        accion: accion || accionGenerica(tipo),
        detalle: detalle || resumen(filas)
    };
};

const tipoPorFilas = (filas) =>
    filas.some(f => f.operacion === 'DELETE' || f.operacion === 'TRUNCATE') ? 'eliminar'
  : filas.some(f => f.operacion === 'INSERT') ? 'crear' : 'modificar';

const accionGenerica = (tipo) => ({ crear: 'Registró datos', eliminar: 'Eliminó datos' })[tipo] || 'Modificó datos';

/** «Creó 1 venta y 2 líneas de venta · modificó 2 existencias» */
const resumen = (filas) => {
    const por = { INSERT: [], UPDATE: [], DELETE: [], TRUNCATE: [] };
    for (const f of filas) por[f.operacion]?.push(`${f.n} ${nombreTabla(f.tabla, f.n)}`);
    const lista = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0];
    return [
        por.INSERT.length && `creó ${lista(por.INSERT)}`,
        por.UPDATE.length && `modificó ${lista(por.UPDATE)}`,
        por.DELETE.length && `eliminó ${lista(por.DELETE)}`,
        por.TRUNCATE.length && `vació ${lista(por.TRUNCATE.map(x => x.replace(/^\d+ /, '')))}`
    ].filter(Boolean).join(' · ').replace(/^./, s => s.toUpperCase());
};

// Campos que no aportan en el resumen de una fila (se ven en el detalle)
const SIN_RESUMEN = new Set(['fecha_actualizacion', 'fecha_precio', 'fecha_calculo']);

/** «Precio: Bs. 10.00 → Bs. 12.00» o la lista de campos cambiados */
const cambiosTexto = (f, nombres, moneda) => {
    if (!f?.campos?.length) return null;
    const campos = f.campos.filter(k => !SIN_RESUMEN.has(k));
    if (campos.length > 3) return `${campos.length} campos`;
    return campos.map(k => {
        if (k === 'contrasena_hash') return 'contraseña';
        if (/^url_|_hash$|^ia_info/.test(k)) return nombreCampo(k).toLowerCase();
        const dinero = /precio|monto|inversion/.test(k);
        const v = (x) => dinero && x != null ? `${moneda} ${Number(x).toFixed(2)}` : valorTexto(k, x, nombres);
        return `${nombreCampo(k)}: ${v(f.anterior?.[k])} → ${v(f.nuevo?.[k])}`;
    }).join(' · ');
};

// ─── Detalle de cada fila (antes / después) ───
// Columnas calculadas o internas que no se muestran
const OCULTAS = new Set(['subtotal', 'subtotal_detalle']);

const camposDeFila = (f, nombres) => {
    const ant = f.datos_anteriores || {}, nue = f.datos_nuevos || {};
    let claves;
    if (f.operacion === 'UPDATE') claves = f.campos_modificados || [];
    else {
        const datos = f.operacion === 'INSERT' ? nue : ant;
        claves = Object.keys(datos).filter(k => !OCULTAS.has(k) && datos[k] != null
            && !(k.startsWith('id_') && !REFERENCIAS[k] && String(datos[k]) === String(f.id_registro)));
    }
    return claves.map(k => ({
        campo: nombreCampo(k),
        antes:   f.operacion === 'INSERT' ? null : valorTexto(k, ant[k], nombres),
        despues: f.operacion === 'DELETE' ? null : valorTexto(k, nue[k], nombres)
    }));
};

/** Ids a buscar en la BD principal para mostrar nombres */
const idsReferidos = (filas, origenes) => {
    const ids = { producto: new Set(), inventario: new Set(), categoria: new Set(), mesa: new Set(), cuenta: new Set(),
                  sucursal: new Set(), usuario: new Set(), rol: new Set() };
    const agregar = (tipo, v) => { const n = Number(v); if (Number.isInteger(n) && n > 0) ids[tipo].add(n); };
    for (const f of filas) {
        for (const datos of [f.datos_nuevos, f.datos_anteriores]) {
            if (!datos) continue;
            for (const [k, tipo] of Object.entries(REFERENCIAS)) if (datos[k] != null) agregar(tipo, datos[k]);
        }
    }
    // Ids de la ruta (mesa, cuenta, usuario…) según su prefijo
    for (const o of origenes) {
        const r = leerOrigen(o);
        if (!r || !r.ids.length) continue;
        const tipo = /^\/(mesas)\//.test(r.ruta) ? 'mesa'
                   : /^\/cuentas\/:id/.test(r.ruta) ? 'cuenta'
                   : /^\/(usuarios|permisos|caja|ajustes\/telegram)\//.test(r.ruta) ? 'usuario'
                   : /^\/catalogo\/productos/.test(r.ruta) ? 'producto'
                   : /^\/catalogo\/categorias/.test(r.ruta) ? 'categoria'
                   : /^\/sucursales/.test(r.ruta) ? 'sucursal' : null;
        if (tipo) agregar(tipo, r.ids[0]);
    }
    return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, [...v]]));
};

/** 'Ana Pérez <ana@x.com>' → { nombre: 'Ana Pérez', correo: 'ana@x.com' } */
const separarUsuario = (u) => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(u || '');
    return m ? { nombre: m[1], correo: m[2] } : { nombre: u || '—', correo: null };
};

// ─── Navegador legible ───
const navegador = (agente) => {
    if (!agente) return null;
    const so = /Android/.test(agente) ? 'Android' : /iPhone|iPad/.test(agente) ? 'iOS' : /Windows/.test(agente) ? 'Windows'
             : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : null;
    const nav = /Edg\//.test(agente) ? 'Edge' : /OPR\//.test(agente) ? 'Opera' : /Chrome\//.test(agente) ? 'Chrome'
              : /Firefox\//.test(agente) ? 'Firefox' : /Safari\//.test(agente) ? 'Safari' : /node|undici/i.test(agente) ? 'Programa' : null;
    return [nav, so].filter(Boolean).join(' en ') || agente.slice(0, 60);
};

module.exports = {
    MODULOS, describir, camposDeFila, idsReferidos, separarUsuario, navegador,
    filtroAccion, filtroModulo, leerOrigen, nombreTabla, valorTexto
};
