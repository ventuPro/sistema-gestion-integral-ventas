// ─── Guía de uso del sistema para el asistente del personal ───
// Una sección por módulo; el asistente solo recibe las que el usuario puede usar.
// modulo: permiso que se exige (null = solo administrador).
const GUIAS = {
    panel: { modulo: 'dashboard', titulo: 'Panel principal', resumen: 'resumen del día (ingresos, cobros, turnos abiertos, stock por reponer, lo más vendido).', texto: `
Menú lateral → «Panel principal». Muestra el día en curso: ingresos de hoy comparados con ayer a la misma hora, ventas, ticket promedio, ritmo de ventas por hora, cobros por método (efectivo / QR), turnos de caja abiertos con el efectivo que debería haber, consumo por cobrar en mesas, pedidos del menú QR, alertas de stock («Stock por reponer», con enlace «Ver inventario»), lo más vendido hoy y las últimas ventas. Se actualiza solo.
El administrador elige la sucursal (o «Todas») con el selector de sucursal de arriba. «Últimos 7 días vs. 7 anteriores» compara las ventas de la última semana con la semana previa. El ticket promedio es el ingreso por venta.
«Promociones» muestra cuántas promociones están vigentes ahora y lo ahorrado con promociones y con descuentos manuales hoy.` },

    punto_venta: { modulo: 'punto_venta', titulo: 'Punto de venta', resumen: '«Abrir la caja del día» con el fondo inicial; vender tocando productos → «Cobrar venta» → método de pago → «Confirmar venta».', texto: `
Menú lateral → «Punto de venta».
Abrir caja: al empezar el día aparece «Abrir la caja del día»; escribe el «Fondo inicial» (el efectivo con el que empiezas, contado) y confirma. No necesita autorización del administrador. Sin caja abierta no se puede vender ni cobrar mesas. Si la caja ya se cerró hoy, no se puede vender hasta que el administrador la reabra («Verificar de nuevo» revisa si ya la reabrió).
Vender: toca los productos del catálogo (puedes buscar o filtrar por categoría) y se suman a «Venta actual»; ajusta cantidades con − y +. Luego «Cobrar venta» → elige el «Método de pago» (Efectivo o QR). En efectivo puedes escribir el «Monto recibido» (opcional) y el sistema calcula el «Cambio». Con QR se muestra el QR de cobro del negocio (si se cargó en Ajustes → Parámetros) para que el cliente lo escanee; confirma cuando el cliente haya pagado. Toca «Confirmar venta». Se puede imprimir el comprobante.
«Ventas de hoy» lista tus ventas del día con su detalle.
Solo se venden productos con stock en tu sucursal; el precio siempre es el registrado en el sistema.
Promociones: se aplican solas. Los productos con promoción vigente llevan una etiqueta en el catálogo («−20 %», «3×2», «Combo»…) y en «Venta actual» se ve el precio normal tachado, el nombre de la promoción y lo que se ahorra; abajo, «Subtotal», «Promociones» y el «Total». Si un producto entra en varias promociones se aplica la que más ahorra al cliente.
Descuento manual: botón «Descuento» junto a «Cobrar». Elige % o monto en bolivianos, escribe el «Motivo» (obligatorio) y «Aplicar». El cajero tiene un tope (por defecto 10 % de la venta, lo define el administrador en Ajustes → Parámetros → «Descuento máximo del cajero»); el administrador no tiene tope. Se quita con la ✕ junto al descuento. Queda registrado en la venta con su motivo y en el comprobante («Usted ahorró…»).` },

    mesas: { modulo: 'mesas', titulo: 'Mesas y pedidos del menú QR', resumen: 'tocar una mesa para agregar consumo y cobrar (todo o por cliente con «Cobrar» en su grupo); «Reiniciar mesa»; «Nueva mesa»; «Códigos QR»; los pedidos del menú QR se atienden en «Pedidos QR» (Confirmar / Rechazar / Entregado).', texto: `
Menú lateral → «Mesas». Requiere tener la caja abierta (en «Punto de venta»).
Colores: Libre, Con cuenta (consumo por cobrar). Toca una mesa para abrirla: agrega productos desde el catálogo al «Consumo actual» (el stock se reserva al agregar); puedes quitar productos.
Cobrar: en la mesa toca «Cobrar y cerrar mesa», elige el «Método de pago», opcionalmente el «Monto recibido» para calcular el cambio, y confirma; la mesa queda libre y se registra la venta.
Pagar por separado: si los clientes pidieron cada uno desde su celular, el consumo aparece agrupado por cliente (con su nombre, o «Cliente 1», «Cliente 2»…; lo que agregó el cajero va en «Cargado por el cajero»). Cada grupo tiene el botón «Cobrar» para cobrar solo su parte; la mesa sigue abierta hasta que se pague todo. «Cobrar todo y cerrar mesa» cobra lo que falte de una vez. Lo ya pagado se marca «Pagado» y no se puede quitar. Al cobrar (todo o una parte) se aplican solas las promociones vigentes; en la ventana de cobro, «Descuento» permite un descuento manual (% o monto, con motivo obligatorio y el mismo tope que en el punto de venta), que se quita con la ✕.
«Reiniciar mesa» cancela la cuenta, devuelve el stock y libera la mesa.
«Nueva mesa» crea una mesa con su número; una mesa libre se puede eliminar con el ícono de papelera (su QR impreso deja de funcionar). «Códigos QR» genera los QR de todas las mesas para imprimirlos y pegarlos en cada mesa: el cliente lo escanea y ve el menú y pide desde su celular. La dirección que lleva el QR debe poder abrirse desde el celular (con «localhost» solo funciona en esa computadora: usa la IP de la computadora en la red del local, por ejemplo http://192.168.1.10:4200). En cada mesa se puede «Nuevo QR» (el anterior deja de funcionar).
Sin caja abierta no se pueden atender mesas; si la caja se cerró hoy, hay que pedir al administrador que la reabra.
Pedidos QR: el cliente escanea el QR de su mesa, elige productos y envía el pedido. Aparece en «Pedidos QR» (barra superior / menú) con aviso. El cajero puede ajustar cantidades, «Confirmar» (se carga a la cuenta de la mesa), «Rechazar» (el stock vuelve) y marcar «Entregado». Si nadie confirma a tiempo, el pedido vence solo.` },

    arqueo: { modulo: 'arqueo', titulo: 'Arqueo y cierre de caja', resumen: '«Arqueo de caja»: contar el efectivo y «Cerrar caja».', texto: `
Menú lateral → «Arqueo de caja». Muestra el «Efectivo que debe haber en caja» = Fondo inicial + Cobrado en efectivo, y los cobros del turno por método. Solo el efectivo debe estar físicamente en la caja; los cobros por QR se verifican en la cuenta del banco.
Abajo están las ventas de hoy registradas por el usuario y el detalle de cada venta.
Cerrar el turno: 1) cuenta el efectivo de la caja (puedes usar «Contar por billetes y monedas»); escribirlo es opcional, pero si lo escribes queda registrado junto con la diferencia (sobrante o faltante) para el administrador. 2) toca «Cerrar caja» → «Confirmar cierre».
Al cerrar ya no puedes registrar ventas ni atender mesas hasta que el administrador reabra tu caja (puede hacerlo durante las 24 horas siguientes). Al día siguiente abres una caja nueva con un nuevo fondo inicial.` },

    inventario: { modulo: 'inventario', titulo: 'Inventario', resumen: '«Nuevo producto», «Nueva categoría»; para cambiar stock: botón «Movimiento» en la fila del producto → «Entrada» (suma la cantidad) o «Merma o salida» (la resta) con motivo; historial en la pestaña «Movimientos». El stock no se edita directamente.', texto: `
Menú lateral → «Inventario». Pestaña «Productos»: lista con precio, stock y estado; filtros por categoría y búsqueda; indicadores de stock bajo y sin stock.
«Nuevo producto»: nombre, descripción (opcional), categoría, precio, imagen (JPG, PNG o WEBP, máximo 2 MB) y «Stock inicial»; después se suman unidades con «Movimiento». «Nueva categoría» crea categorías.
«Movimiento» (botón en la fila de cada producto): registra una «Entrada» (suma al stock: compra, producción, devolución…) o una «Merma o salida» (resta: vencido, dañado, consumo interno…); escribe la cantidad y elige el motivo; muestra el stock en que queda. La cantidad se suma o se resta: para dejar el stock en un número exacto, registra la diferencia con el stock actual. Una salida nunca puede dejar el stock en negativo.
Pestaña «Movimientos»: historial de todo cambio de stock (ventas, mesas, pedidos QR, entradas y mermas) con fecha, usuario, motivo y saldo; filtros Hoy / 7 días / 30 días y Entradas / Salidas.
El cajero solo ve y mueve el stock de su sucursal.` },

    reportes: { modulo: 'reportes', titulo: 'Reportes (informes)', resumen: 'elegir período (y sucursal); exportar a PDF o Excel.', texto: `
Menú lateral → «Reportes». Elige el período (fechas) y, si eres administrador, la sucursal; puedes filtrar por categorías.
Incluye: ingresos del período comparados con el período anterior, ventas, ticket promedio, unidades, mejor día, venta más alta (en una sola venta), evolución diaria (abre un día para ver sus categorías), horas de mayor venta, promedio por día de la semana, comparativo de sucursales, cobros por método, desempeño por cajero, ventas por categoría, productos vendidos (y sin ventas), turnos cerrados con su arqueo, inventario actual y pedidos del menú QR.
Se puede exportar a PDF o Excel e imprimir.
La sección «Promociones y descuentos» muestra lo ahorrado con promociones y con descuentos manuales, cada promoción con sus ventas, unidades, ahorro e ingresos, los descuentos manuales por cajero y los últimos descuentos con su motivo. También va en el PDF y en el Excel (hojas «Promociones» y «Descuentos manuales»).` },

    promociones: { modulo: 'promociones', titulo: 'Promociones', resumen: '«Nueva promoción»: nombre, tipo (Porcentaje, Precio especial, Lleva N paga M, Combo), productos o categorías, fechas, días y horario; activar/desactivar.', texto: `
Menú lateral → «Promociones» (el administrador da este permiso en Usuarios → «Permisos de acceso»). Arriba: «Vigentes ahora», «Programadas», «Ventas con promoción» y «Ahorro otorgado». Filtros: Vigentes ahora, Activas, Inactivas, Todas.
«Nueva promoción»: «Nombre» y «Tipo»:
- Porcentaje: descuento en % sobre productos o categorías (por ejemplo −20 % en toda la categoría Tortas).
- Precio especial: un precio por unidad más bajo que el normal, para productos (por ejemplo cuñapé a 2 Bs.).
- Lleva N, paga M: por ejemplo 3×2 (lleva 3, paga 2) en productos o categorías.
- Combo: varios productos con su cantidad a un precio fijo (por ejemplo café + porción de torta a 15 Bs.); se muestra el precio normal y el ahorro. El precio del combo debe ser menor al normal.
Vigencia: «Desde» y «Hasta» (fechas), los «Días» de la semana en que vale y, opcional, «Solo en un horario» (por ejemplo la hora feliz de 18:00 a 21:00, o una liquidación al final del día). El administrador elige la «Sucursal» o «Todas las sucursales»; el cajero solo crea promociones de su sucursal, y las de todas las sucursales las ve con un candado (no puede cambiarlas).
Se aplican solas al cobrar en el punto de venta y en las mesas; si un producto entra en varias, gana la que más ahorra al cliente. Un combo solo se usa cuando ahorra más que las otras promociones.
En la lista: lápiz = editar, botón de encendido = activar/desactivar, papelera = eliminar (solo si nunca se usó en una venta; si ya se usó, se desactiva para conservar el historial).` },

    usuarios: { modulo: 'usuarios', titulo: 'Usuarios', resumen: '«Nuevo usuario», cambiar contraseña, activar/desactivar, habilitar caja y «Permisos de acceso».', texto: `
Menú lateral → «Usuarios». «Nuevo usuario»: nombre completo, correo, contraseña, rol (Administrador o Cajero) y sucursal.
En cada usuario: editar (la contraseña no se cambia ahí: se cambia con el botón de la llave de la lista), «Cambiar contraseña», activar o desactivar (un usuario inactivo no puede entrar), habilitar su caja y ajustar «Permisos de acceso» por módulo (Panel, Punto de venta, Mesas, Arqueo, Inventario, Reportes, Usuarios). Los permisos nuevos se aplican al instante en la sesión abierta del usuario: su menú cambia y, si estaba en una pantalla que ya no puede ver, sale de ella.` },

    cierres: { modulo: null, titulo: 'Cierres de caja (administrador)', resumen: 'turnos cerrados y resultado del arqueo.', texto: `
Menú lateral → «Cierres de caja». Lista los turnos cerrados con cajero, ventas, total, efectivo y el resultado del arqueo («Cuadra», sobrante o faltante, o «sin conteo» si el cajero no contó el efectivo). Arriba muestra el total recaudado en todos los turnos, lo cobrado en efectivo y QR y las diferencias de arqueo.` },

    ajustes: { modulo: null, titulo: 'Ajustes (administrador)', resumen: 'pestañas Empresa, Apariencia, Propietarios, Sucursales, Parámetros y Chatbot.', texto: `
Menú lateral → «Ajustes». Pestañas:
- Empresa: «Identidad» (nombre comercial, rubro, eslogan: aparecen en el menú, los tickets y el menú QR), «Inicio de sesión» (texto grande junto al formulario de ingreso; vacío = nombre comercial), «Datos legales» (razón social, NIT: se imprimen en los comprobantes), contacto, ubicación y redes sociales.
- Apariencia: logo (PNG, JPG o WEBP hasta 2 MB, mejor con fondo transparente; aparece en el menú, los tickets y el menú QR) e ícono (PNG cuadrado o ICO hasta 512 KB; se ve en la pestaña del navegador). Colores: el principal se usa en botones, menús y encabezados; el secundario en degradados y detalles (paletas listas o personalizados). Tema: claro, oscuro o automático (según el dispositivo); lo ven todo el personal y los clientes del menú QR. Los cambios se ven al instante como vista previa, pero se guardan solo con «Guardar apariencia».
- Propietarios: socios y su porcentaje (la suma no pasa de 100 %). Son datos privados: solo los ve el administrador y no salen en tickets ni en el menú QR.
- Sucursales: crear, editar, activar o desactivar y horario por día. Una sucursal desactivada conserva su historial, pero no abre caja ni recibe pedidos del menú QR. Si cierra después de medianoche, la hora de cierre va menor que la de apertura (ej. 18:00 a 02:00).
- Parámetros: símbolo de moneda (se muestra junto a los precios); mensaje al pie del ticket; ancho del ticket (58 mm y 80 mm para impresoras térmicas, A4 para impresora común; al imprimir se elige la impresora); métodos de pago Efectivo y QR (al menos uno); QR de cobro (imagen del QR del banco que se muestra al cobrar por QR). Menú QR: recibir pedidos (apagado, los clientes solo ven el menú y piden en caja), mensaje de bienvenida (sale en la pantalla de bienvenida del menú), vencimiento de pedidos sin confirmar (pasado ese tiempo se cancelan solos y el stock vuelve), pedidos pendientes por mesa (cuántos pueden esperar confirmación a la vez) y pedidos por celular cada 10 minutos (evita pedidos falsos). Stock mínimo por defecto: alerta de stock bajo para productos nuevos (no cambia los existentes). Descuento máximo del cajero: el % de la venta que un cajero puede descontar a mano en el punto de venta (el administrador no tiene tope). Seguridad: CAPTCHA (código de la imagen; evita que un programa pruebe contraseñas, se recomienda dejarlo activo), intentos fallidos permitidos (luego se bloquea esa cuenta en ese equipo), duración del bloqueo y duración de la sesión (se aplica desde el próximo inicio de sesión).
- Chatbot: estado de los asistentes (siempre activos con la clave de Groq; el sistema elige el modelo y cambia solo si uno llega a su límite gratuito, y limita las preguntas por celular y por usuario), «Probar conexión» e «Información para el chatbot del menú» (hasta 3000 caracteres: lo que el propietario quiere que el asistente responda a los clientes, como encargos, recomendaciones o reglas del local; ya conoce la carta, precios, stock, horarios y contacto). A Groq solo se envía lo necesario (carta, horarios, totales, stock); nunca contraseñas, propietarios ni datos personales de clientes.` }
};

/** Secciones que puede consultar el usuario según sus permisos */
const guiasPermitidas = (esAdmin, permisos) =>
    Object.entries(GUIAS)
        .filter(([, g]) => esAdmin || (g.modulo && permisos[g.modulo] === true))
        .map(([clave, g]) => ({ clave, titulo: g.titulo, resumen: g.resumen, texto: g.texto.trim() }));

module.exports = { guiasPermitidas };
