// ─── Nombres de productos parecidos (contra duplicados con otro nombre) ───
// Compara palabra por palabra sin importar mayúsculas, acentos, plurales, palabras de enlace
// («de», «con»...), el orden, cómo suena (b/v, s/z/c, ll/y, h, qu/k) ni errores de una o dos letras.
// Los números y medidas deben coincidir: «COCA COLA 2 L» no es «COCA COLA 3 L».

const ENLACE = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'con', 'y', 'e', 'en', 'a', 'al', 'para', 'por',
                        'un', 'una', 'unos', 'unas', 'x', 'c', 'sin']);
// «sin» importa (sin azúcar ≠ con azúcar), pero se trata como palabra propia más abajo
const IMPORTA = new Set(['sin']);

// Números escritos con letras: «TRES LECHES» = «3 LECHES»
const NUMEROS = { dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10',
                  once: '11', doce: '12', quince: '15', veinte: '20', medio: '1_2', media: '1_2' };

/** Formas posibles en singular: «panes» → pan, «cuñapés» → cuñape (las dos se prueban) */
const singulares = (p) => {
    if (/\d/.test(p)) return [p];
    if (p.length <= 3) return /^[a-z]{1,2}[aeiou]s$/.test(p) ? [p, p.slice(0, -1)] : [p];   // tes → te
    if (p.endsWith('ces')) return [p.slice(0, -3) + 'z', p.slice(0, -1)];          // nueces → nuez
    if (/[^aeiou]es$/.test(p)) return [p.slice(0, -1), p.slice(0, -2)];            // cuñapes → cuñape, panes → pan
    if (/[aeiou]s$/.test(p) && !/(is|us)$/.test(p)) return [p.slice(0, -1)];       // empanadas → empanada
    return [p];
};

/** Cómo suena (claves iguales = se oyen igual) */
const sonido = (p) => {
    if (/^\d/.test(p)) return p;
    let s = p
        .replace(/cc([ei])/g, '#$1')                    // cappuccino = capuchino
        .replace(/ch/g, '#')
        .replace(/qu([ei])/g, 'k$1').replace(/q/g, 'k')
        .replace(/c([ei])/g, 's$1').replace(/c/g, 'k')
        .replace(/z/g, 's')
        .replace(/gu([ei])/g, 'g$1').replace(/g([ei])/g, 'j$1')
        .replace(/ll/g, 'y').replace(/v/g, 'b').replace(/w/g, 'u')
        .replace(/([^aeiou])y/g, '$1i')                 // pye = pie
        .replace(/h/g, '')
        .replace(/x/g, 'ks')
        .replace(/y$/, 'i')
        .replace(/(.)\1+/g, '$1');
    return s || p;
};

/** Palabras que cuentan, en forma comparable */
const palabras = (texto) => {
    const llano = String(texto || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/(\d)[.,](\d)/g, '$1_$2')               // 1.5 L / 1,5 L → 1_5
        .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')   // 2lt → 2 lt
        .replace(/[^a-z0-9_ ]+/g, ' ');
    return llano.split(/\s+/).filter(p => p && (!ENLACE.has(p) || IMPORTA.has(p)))
        .map(p => {
            if (NUMEROS[p]) p = NUMEROS[p];
            if (/^\d/.test(p)) return { texto: p, sonido: p, numero: true };
            const formas = singulares(p);
            return { texto: formas[0], sonido: sonido(formas[0]), formas, sonidos: formas.map(sonido), numero: false };
        });
};

/** Distancia de edición con transposición (Damerau-Levenshtein) */
const distancia = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    return d[a.length][b.length];
};

/** Parecido de dos palabras, de 0 a 1 */
const parecidoPalabra = (a, b) => {
    if (a.numero || b.numero) return a.texto === b.texto ? 1 : 0;
    if (a.formas.some(f => b.formas.includes(f))) return 1;
    if (a.sonidos.some(f => b.sonidos.includes(f))) return 0.95;
    const corta = a.texto.length <= b.texto.length ? a.texto : b.texto;
    const larga = corta === a.texto ? b.texto : a.texto;
    // Abreviatura clara: «choc.» de chocolate no, «empanad» de empanada sí
    if (corta.length >= 5 && larga.startsWith(corta) && corta.length / larga.length >= 0.6) return 0.8;
    const L = Math.max(a.sonido.length, b.sonido.length);
    const dist = Math.min(distancia(a.texto, b.texto), distancia(a.sonido, b.sonido));
    // Una letra de diferencia en palabras cortas puede ser otro producto (coco / cocoa): parecido, no igual
    if (dist === 1) return L >= 7 ? 0.9 : L >= 5 ? 0.8 : 0;
    if (dist === 2 && L >= 8) return 0.75;
    return 0;
};

/** Trigramas del nombre pegado (para «empanadaqueso» contra «empanada de queso») */
const trigramas = (ps) => {
    const s = `  ${ps.map(p => p.sonido).join('')} `;
    const t = new Map();
    for (let i = 0; i < s.length - 2; i++) { const g = s.slice(i, i + 3); t.set(g, (t.get(g) || 0) + 1); }
    return t;
};
const dice = (a, b) => {
    let comun = 0, total = 0;
    for (const [g, n] of a) { comun += Math.min(n, b.get(g) || 0); total += n; }
    for (const n of b.values()) total += n;
    return total ? (2 * comun) / total : 0;
};

/**
 * Qué tan parecidos son dos nombres: { puntaje 0..1, tipo }.
 * tipo: 'igual' (mismas palabras), 'casi' (solo plurales, acentos o errores de escritura: casi seguro el mismo),
 * 'parecido' (una palabra cambia poco: «COCO» / «COCOA»), 'contiene' (uno incluye al otro: «EMPANADA» y
 * «EMPANADA DE QUESO») o null.
 */
const comparar = (nombreA, nombreB) => {
    const A = palabras(nombreA), B = palabras(nombreB);
    if (!A.length || !B.length) return { puntaje: 0, tipo: null };
    const mejorA = A.map(a => Math.max(...B.map(b => parecidoPalabra(a, b))));
    const mejorB = B.map(b => Math.max(...A.map(a => parecidoPalabra(a, b))));
    const suma = (l) => l.reduce((s, x) => s + x, 0);
    const porPalabras = (suma(mejorA) + suma(mejorB)) / (A.length + B.length);
    // Un número o medida distinta (2 L / 3 L) o un «sin» de un lado separa los productos aunque el resto sea igual
    const numeros = (l) => l.filter(p => p.numero).map(p => p.texto).sort().join(' ');
    const conSin = (l) => l.some(p => p.texto === 'sin');
    if (numeros(A) !== numeros(B) || conSin(A) !== conSin(B)) return { puntaje: Math.min(porPalabras, 0.6), tipo: null };

    const todas = (umbral) => mejorA.every(x => x >= umbral) && mejorB.every(x => x >= umbral);
    if (todas(1)) return { puntaje: 1, tipo: 'igual' };
    const pegado = dice(trigramas(A), trigramas(B));
    if (todas(0.85) || pegado >= 0.9) return { puntaje: Math.max(porPalabras, pegado), tipo: 'casi' };
    // Todas las palabras de uno están en el otro (el otro agrega algo: «CROASANT DE QUESO» / «CROASANT JAMÓN Y QUESO»)
    if (mejorA.every(x => x >= 0.85) || mejorB.every(x => x >= 0.85)) return { puntaje: Math.max(porPalabras, 0.7), tipo: 'contiene' };
    if (porPalabras >= 0.75) return { puntaje: porPalabras, tipo: 'parecido' };
    return { puntaje: porPalabras, tipo: null };
};

/**
 * Los más parecidos a `nombre` de una lista [{ id_producto, nombre_producto, ... }], del más al menos parecido.
 * Devuelve cada uno con { parecido, tipo }.
 */
const buscar = (nombre, lista, { maximo = 5, excluir = null } = {}) =>
    lista.filter(p => p.id_producto !== excluir)
        .map(p => ({ ...p, ...(({ puntaje, tipo }) => ({ parecido: Math.round(puntaje * 100) / 100, tipo }))(comparar(nombre, p.nombre_producto)) }))
        .filter(p => p.tipo)
        .sort((a, b) => b.parecido - a.parecido || a.nombre_producto.localeCompare(b.nombre_producto))
        .slice(0, maximo);

/** Tan parecido que casi seguro es el mismo producto: el servidor pide confirmar antes de crearlo */
const esCasiIgual = (r) => r.tipo === 'igual' || r.tipo === 'casi';

module.exports = { comparar, buscar, esCasiIgual, palabras };
