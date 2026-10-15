// ─── Guía de uso del sistema para el asistente del personal ───
// Una sección por módulo; el asistente solo recibe las que el usuario puede usar.
// modulo: permiso que se exige (null = solo administrador).
const GUIAS = {
    panel: { modulo: 'dashboard', titulo: 'Panel principal', resumen: 'resumen del día (ingresos, cobros, turnos abiertos, stock por reponer, lo más vendido).', texto: `
Menú lateral → «Panel principal». Muestra el día en curso: ingresos de hoy comparados con ayer a la misma hora, ventas, ticket promedio, ritmo de ventas por hora, cobros por método (efectivo / QR), turnos de caja abiertos con el efectivo que debería haber, consumo por cobrar en mesas, pedidos del menú QR, alertas de stock («Stock por reponer», con enlace «Ver inventario»), lo más vendido hoy y las últimas ventas. Se actualiza solo.
El administrador elige la sucursal (o «Todas») con el selector de sucursal de arriba.` },

    punto_venta: { modulo: 'punto_venta', titulo: 'Punto de venta', resumen: '«Abrir la caja del día» con el fondo inicial; vender tocando productos → «Cobrar venta» → método de pago → «Confirmar venta».', texto: `
Menú lateral → «Punto de venta».
Abrir caja: al empezar el día aparece «Abrir la caja del día»; escribe el «Fondo inicial» (efectivo con el que empiezas) y confirma. Sin caja abierta no se puede vender ni cobrar mesas.
Vender: toca los productos del catálogo (puedes buscar o filtrar por categoría) y se suman a «Venta actual»; ajusta cantidades con − y +. Luego «Cobrar venta» → elige el «Método de pago» (Efectivo o QR). En efectivo puedes escribir el «Monto recibido» y el sistema calcula el «Cambio». Toca «Confirmar venta». Se puede imprimir el comprobante.
«Ventas de hoy» lista tus ventas del día con su detalle.
Solo se venden productos con stock en tu sucursal; el precio siempre es el registrado en el sistema.` },

    mesas: { modulo: 'mesas', titulo: 'Mesas y pedidos del menú QR', resumen: 'tocar una mesa para agregar consumo y cobrar (todo o por cliente con «Cobrar» en su grupo); «Reiniciar mesa»; «Nueva mesa»; «Códigos QR»; los pedidos del menú QR se atienden en «Pedidos QR» (Confirmar / Rechazar / Entregado).', texto: `
Menú lateral → «Mesas». Requiere tener la caja abierta (en «Punto de venta»).
Colores: Libre, Con cuenta (consumo por cobrar). Toca una mesa para abrirla: agrega productos desde el catálogo al «Consumo actual» (el stock se reserva al agregar); puedes quitar productos.
Cobrar: en la mesa toca «Cobrar y cerrar mesa», elige el «Método de pago», opcionalmente el «Monto recibido» para calcular el cambio, y confirma; la mesa queda libre y se registra la venta.
Pagar por separado: si los clientes pidieron cada uno desde su celular, el consumo aparece agrupado por cliente (con su nombre, o «Cliente 1», «Cliente 2»…; lo que agregó el cajero va en «Cargado por el cajero»). Cada grupo tiene el botón «Cobrar» para cobrar solo su parte; la mesa sigue abierta hasta que se pague todo. «Cobrar todo y cerrar mesa» cobra lo que falte de una vez. Lo ya pagado se marca «Pagado» y no se puede quitar.
«Reiniciar mesa» cancela la cuenta, devuelve el stock y libera la mesa.
«Nueva mesa» crea una mesa con su número. «Códigos QR» genera e imprime los QR de todas las mesas; en cada mesa se puede «Generar nuevo QR» (el anterior deja de funcionar).
Pedidos QR: el cliente escanea el QR de su mesa, elige productos y envía el pedido. Aparece en «Pedidos QR» (barra superior / menú) con aviso. El cajero puede ajustar cantidades, «Confirmar» (se carga a la cuenta de la mesa), «Rechazar» (el stock vuelve) y marcar «Entregado». Si nadie confirma a tiempo, el pedido vence solo.` },

    arqueo: { modulo: 'arqueo', titulo: 'Arqueo y cierre de caja', resumen: '«Arqueo de caja»: contar el efectivo y «Cerrar caja».', texto: `
Menú lateral → «Arqueo de caja». Muestra el «Efectivo que debe haber en caja» = Fondo inicial + Cobrado en efectivo, y los cobros del turno.
Cerrar el turno: cuenta el efectivo de la caja (billetes y monedas), revisa el «Total contado» y la «Diferencia» con lo esperado, y toca «Cerrar caja» → confirma. Después de cerrar ya no puedes vender ese día salvo que el administrador lo habilite de nuevo.` },

    inventario: { modulo: 'inventario', titulo: 'Inventario', resumen: '«Nuevo producto», «Nueva categoría»; para cambiar stock: botón «Movimiento» en la fila del producto → «Entrada» (suma la cantidad) o «Merma o salida» (la resta) con motivo; historial en la pestaña «Movimientos». El stock no se edita directamente.', texto: `
Menú lateral → «Inventario». Pestaña «Productos»: lista con precio, stock y estado; filtros por categoría y búsqueda; indicadores de stock bajo y sin stock.
«Nuevo producto»: nombre, descripción, categoría, precio, imagen (JPG, PNG o WEBP, máx. 2 MB) y «Stock inicial». «Nueva categoría» crea categorías.
«Movimiento» (botón en la fila de cada producto): registra una «Entrada» (suma al stock: compra, producción, devolución…) o una «Merma o salida» (resta: vencido, dañado, consumo interno…); escribe la cantidad y elige el motivo; muestra el stock en que queda. La cantidad se suma o se resta: para dejar el stock en un número exacto, registra la diferencia con el stock actual. Una salida nunca puede dejar el stock en negativo.
Pestaña «Movimientos»: historial de todo cambio de stock (ventas, mesas, pedidos QR, entradas y mermas) con fecha, usuario, motivo y saldo; filtros Hoy / 7 días / 30 días y Entradas / Salidas.
El cajero solo ve y mueve el stock de su sucursal.` },

    reportes: { modulo: 'reportes', titulo: 'Reportes (informes)', resumen: 'elegir período (y sucursal); exportar a PDF o Excel.', texto: `
Menú lateral → «Reportes». Elige el período (fechas) y, si eres administrador, la sucursal; puedes filtrar por categorías.
Incluye: ingresos del período comparados con el período anterior, ventas, ticket promedio, unidades, mejor día, evolución diaria, horas de mayor venta, promedio por día de la semana, comparativo de sucursales, cobros por método, desempeño por cajero, ventas por categoría, productos vendidos (y sin ventas), turnos cerrados con su arqueo, inventario actual y pedidos del menú QR.
Se puede exportar a PDF o Excel e imprimir.` },

    usuarios: { modulo: 'usuarios', titulo: 'Usuarios', resumen: '«Nuevo usuario», cambiar contraseña, activar/desactivar, habilitar caja y «Permisos de acceso».', texto: `
Menú lateral → «Usuarios». «Nuevo usuario»: nombre completo, correo, contraseña, rol (Administrador o Cajero) y sucursal.
En cada usuario: editar, «Cambiar contraseña», activar o desactivar (un usuario inactivo no puede entrar), habilitar su caja y ajustar «Permisos de acceso» por módulo (Panel, Punto de venta, Mesas, Arqueo, Inventario, Reportes, Usuarios).` },

    cierres: { modulo: null, titulo: 'Cierres de caja (administrador)', resumen: 'turnos cerrados y resultado del arqueo.', texto: `
Menú lateral → «Cierres de caja». Lista los turnos cerrados con cajero, ventas, total, efectivo y el resultado del arqueo («Cuadra», sobrante o faltante, o «sin conteo»). Muestra el total recaudado y las diferencias de arqueo.` },

    ajustes: { modulo: null, titulo: 'Ajustes (administrador)', resumen: 'pestañas Empresa, Apariencia, Propietarios, Sucursales, Parámetros y Chatbot.', texto: `
Menú lateral → «Ajustes». Pestañas:
- Empresa: nombre comercial, datos legales (razón social, NIT), contacto, ubicación, redes sociales y el texto del inicio de sesión.
- Apariencia: logo, ícono, colores (paletas listas o personalizados) y tema claro / oscuro / automático.
- Propietarios: socios y su porcentaje (la suma no pasa de 100 %).
- Sucursales: crear, editar, activar o desactivar y horario por día.
- Parámetros: moneda, métodos de pago, QR de cobro, pie y ancho del ticket (58 mm, 80 mm, A4), menú QR (activar, bienvenida, vencimiento y límites), stock mínimo por defecto y seguridad del inicio de sesión.
- Chatbot: estado de los asistentes (siempre activos), «Probar conexión» e «Información para el chatbot» (lo que el propietario quiere que el asistente del menú responda a los clientes).` }
};

/** Secciones que puede consultar el usuario según sus permisos */
const guiasPermitidas = (esAdmin, permisos) =>
    Object.entries(GUIAS)
        .filter(([, g]) => esAdmin || (g.modulo && permisos[g.modulo] === true))
        .map(([clave, g]) => ({ clave, titulo: g.titulo, resumen: g.resumen, texto: g.texto.trim() }));

module.exports = { guiasPermitidas };
