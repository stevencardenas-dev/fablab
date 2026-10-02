// Lector mínimo de PDF, sin dependencias: lo justo para verificar una hoja
// impresa, que es lo que hace scripts/verificar-impresion.mjs.
//
// ¿Por qué parsear el PDF a mano en vez de usar poppler (`pdfinfo`, `pdftoppm`)
// o Python/PIL, que es lo que se usó a mano la primera vez? Porque el gate tiene
// que correr en cualquier máquina y en CI sin instalar nada: lo único externo que
// necesita es Chrome (que ya está en los runners y en las máquinas de trabajo).
//
// De un PDF de Chrome se lee:
//   1. el tamaño de hoja de cada página (`/MediaBox`), resuelto como lo hace el
//      visor (el valor puede estar heredado del nodo `/Pages`);
//   2. la **caja de tinta**: el rectángulo que ocupan las formas oscuras,
//      recorriendo el stream de contenido (que Chrome comprime con FlateDecode).
//      La caja de tinta es lo que revela una etiqueta cortada: una que quedó
//      rebanada por el borde deja tinta pegada al límite de la hoja.
//
// Lo que NO es: un lector de PDF. Ignora transparencia, recursos, fuentes y
// clips. Solo cuenta como tinta el relleno oscuro (`re`/texto con color < 0.5) y
// el trazo oscuro (`m`/`l`), que es exactamente el criterio que usó la medición
// con PIL (umbral de gris < 128) sobre la página rasterizada: las guías de corte
// son gris claro (0.7333) y no cuentan, igual que en la medición con PIL.

import { inflateSync } from 'node:zlib';

const COLOR_OSCURO = 0.5;

function esOscuro([r, g, b]) {
  return r < COLOR_OSCURO && g < COLOR_OSCURO && b < COLOR_OSCURO;
}

// Producto de matrices `a · b` en la convención de PDF (punto fila: se aplica `a`
// y después `b`), con las 6 componentes [a b c d e f].
function producto(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function aplicar(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Caja de tinta del contenido de una página, en puntos de PDF (origen abajo a la
 * izquierda, como el `/MediaBox`).
 *
 * Detalle que importa: un camino se acumula al **pintarse**, no al construirse.
 * `0 0 816 1056 re W* n` es un rectángulo de recorte que se dibuja con `n` (no
 * pinta nada) y que abarca la hoja entera; contarlo como tinta daría márgenes de
 * 0 en todas las hojas. Por eso se guarda el camino y solo se vuelca a la caja
 * cuando aparece un operador que pinta (`f`, `S`, `B`, `b`…), con el color que
 * tenga en ese momento: relleno oscuro para `f`, trazo oscuro para `S`.
 *
 * El texto se cuenta por su origen: alcanza para lo que se mide (los márgenes) y
 * el texto de la etiqueta vive dentro de la caja del símbolo.
 */
export function cajaDeTinta(ops) {
  const caja = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const sumar = (x, y) => {
    if (x < caja.x0) caja.x0 = x;
    if (y < caja.y0) caja.y0 = y;
    if (x > caja.x1) caja.x1 = x;
    if (y > caja.y1) caja.y1 = y;
  };

  const pila = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let relleno = [0, 0, 0];
  let trazo = [0, 0, 0];
  let texto = [1, 0, 0, 1, 0, 0];
  let camino = [];
  const args = [];

  const volcar = (pintaRelleno, pintaTrazo) => {
    if ((pintaRelleno && esOscuro(relleno)) || (pintaTrazo && esOscuro(trazo))) {
      for (const [x, y] of camino) sumar(x, y);
    }
    camino = [];
  };

  for (const token of ops.match(/[-+]?(?:\d*\.\d+|\d+)|[A-Za-z*'"]+/g) ?? []) {
    if (/^[-+.\d]/.test(token)) {
      args.push(Number(token));
      continue;
    }
    switch (token) {
      case 'q':
        pila.push({ ctm: ctm.slice(), relleno: relleno.slice(), trazo: trazo.slice() });
        break;
      case 'Q': {
        const estado = pila.pop();
        if (estado) ({ ctm, relleno, trazo } = estado);
        break;
      }
      case 'cm':
        if (args.length >= 6) ctm = producto(args.slice(-6), ctm);
        break;
      case 'rg':
        if (args.length >= 3) relleno = args.slice(-3);
        break;
      case 'RG':
        if (args.length >= 3) trazo = args.slice(-3);
        break;
      case 'g':
        if (args.length >= 1) relleno = Array(3).fill(args.at(-1));
        break;
      case 'G':
        if (args.length >= 1) trazo = Array(3).fill(args.at(-1));
        break;
      case 're':
        if (args.length >= 4) {
          const [x, y, ancho, alto] = args.slice(-4);
          for (const [px, py] of [
            [x, y],
            [x + ancho, y],
            [x, y + alto],
            [x + ancho, y + alto],
          ]) {
            camino.push(aplicar(ctm, px, py));
          }
        }
        break;
      case 'm':
      case 'l':
        if (args.length >= 2) camino.push(aplicar(ctm, args.at(-2), args.at(-1)));
        break;
      case 'f':
      case 'F':
      case 'f*':
        volcar(true, false);
        break;
      case 'S':
      case 's':
        volcar(false, true);
        break;
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
        volcar(true, true);
        break;
      case 'n':
      case 'W':
      case 'W*':
        // Recorte o camino descartado: no pinta nada.
        if (token === 'n') camino = [];
        break;
      case 'BT':
        texto = [1, 0, 0, 1, 0, 0];
        break;
      case 'Tm':
        if (args.length >= 6) texto = args.slice(-6);
        break;
      case 'Td':
      case 'TD':
        if (args.length >= 2) texto = producto([1, 0, 0, 1, args.at(-2), args.at(-1)], texto);
        break;
      case 'Tj':
      case 'TJ':
      case "'":
      case '"':
        if (esOscuro(relleno)) sumar(...aplicar(producto(texto, ctm), 0, 0));
        break;
      default:
        break;
    }
    args.length = 0;
  }

  return Number.isFinite(caja.x0) ? caja : null;
}

function cajaDeclarada(cuerpo) {
  const m = cuerpo.match(
    /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/,
  );
  if (!m) return null;
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return { x0, y0, anchoPt: x1 - x0, altoPt: y1 - y0 };
}

/**
 * Páginas del PDF, en orden: tamaño de hoja y caja de tinta (o `null` si la
 * página no tiene tinta).
 */
export function paginasDelPdf(bytes) {
  // latin1 mapea 1 carácter = 1 byte, así que los offsets del texto sirven para
  // leer los streams binarios.
  const texto = bytes.toString('latin1');
  const objetos = [...texto.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)].map((m) => {
    const fin = texto.indexOf('endobj', m.index);
    return { num: Number(m[1]), desde: m.index, hasta: fin < 0 ? texto.length : fin };
  });
  const cuerpo = (o) => texto.slice(o.desde, o.hasta);

  // El /MediaBox puede estar solo en el nodo /Pages (los hijos lo heredan).
  const heredado = objetos.map(cuerpo).map(cajaDeclarada).find(Boolean) ?? null;

  const stream = (num) => {
    const objeto = objetos.find((o) => o.num === num);
    if (!objeto) return '';
    const desde = texto.indexOf('stream', objeto.desde);
    if (desde < 0 || desde > objeto.hasta) return '';
    const salto = texto.startsWith('\r\n', desde + 6) ? 2 : 1;
    const fin = texto.indexOf('endstream', desde);
    const bruto = bytes.subarray(desde + 6 + salto, fin < 0 ? objeto.hasta : fin);
    const comprimido = /FlateDecode/.test(cuerpo(objeto));
    return (comprimido ? inflateSync(bruto) : bruto).toString('latin1');
  };

  return objetos
    .filter((o) => /\/Type\s*\/Page(?![s\w])/.test(cuerpo(o)))
    .map((o) => {
      const c = cuerpo(o);
      const caja = cajaDeclarada(c) ?? heredado;
      const unico = c.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
      const varios = c.match(/\/Contents\s*\[([^\]]*)\]/);
      const numeros = unico
        ? [Number(unico[1])]
        : varios
          ? [...varios[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]))
          : [];
      const ops = numeros.map(stream).join('\n');
      return {
        anchoPt: caja?.anchoPt ?? null,
        altoPt: caja?.altoPt ?? null,
        tinta: ops ? cajaDeTinta(ops) : null,
      };
    });
}
