#!/usr/bin/env node
// verificar-impresion.mjs — la hoja de etiquetas impresa de verdad, no supuesta.
//
// Por qué existe: el paginado y el tamaño de papel los decide el navegador al
// imprimir, así que probar la geometría del SVG (lo que hace Jest) no alcanza.
// Peor: contar los códigos que salen en cada página **tampoco** alcanza — con la
// hoja vieja (un solo SVG que el navegador cortaba) el texto de la etiqueta
// rebanada quedaba entero en la primera página y el conteo daba bien. Lo que lo
// revela es la tinta pegada al borde: una etiqueta cortada deja módulos negros
// justo en el límite de la hoja.
//
// Qué hace, por cada papel (Carta, A4, Oficio):
//   1. arma la hoja con el código de verdad (src/lib), con Chrome headless la
//      imprime a PDF por el camino normal (@page + saltos de página), y
//   2. lee el PDF sin dependencias (scripts/pdf.mjs): cuántas páginas, de qué
//      tamaño, y hasta dónde llega la tinta en cada una.
// Falla si el PDF no tiene las páginas del plan, si alguna página no mide el
// papel pedido, o si en alguna hay tinta a menos de BANDA_MM del borde.
//
// Uso:
//   node scripts/verificar-impresion.mjs              (npm run verify:impresion)
//   node scripts/verificar-impresion.mjs --exigir     (CI: falla si no puede correr)
//   node scripts/verificar-impresion.mjs --guardar /tmp/hoja   (deja los archivos)
//
// Sin navegador no falla: avisa y sale 0 (o 1 con --exigir). En CI, que usa
// Ubuntu, Google Chrome viene preinstalado; `--exigir` es para que un runner sin
// navegador se note en vez de saltarse el chequeo en silencio.
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { paginasDelPdf } from './pdf.mjs';

const ejecutar = promisify(execFile);

const CARPETA = fileURLToPath(new URL('./', import.meta.url));
// El borde de la hoja: el margen de la maqueta es de 10 mm y la tinta arranca
// ~10,5 mm adentro, así que 9 mm es holgado para una hoja bien paginada y sigue
// detectando el corte (una etiqueta rebanada toca el borde).
const BANDA_MM = 9;
const PT_POR_MM = 72 / 25.4;
// 130 etiquetas con la grilla forzada a 6 columnas: más de una página en los tres
// papeles (6 × 16 = 96 por hoja en Carta y A4, 6 × 20 = 120 en Oficio), que es lo
// que hay que ver —que el corte caiga entre etiquetas y no sobre una— con el
// menor trabajo posible para Chrome (~4 s por hoja; con la grilla natural y 300
// etiquetas eran 12 s, y el gate no gana nada por pagar eso: la densidad real de
// la hoja la prueban los tests de geometría de src/lib/data-matrix-svg.test.ts).
// La columna 0 sigue empezando en el margen de 10 mm, que es donde importa.
const ETIQUETAS_POR_CASO = 130;
const COLUMNAS_POR_CASO = 6;
const PEDIDOS = [
  // El caso de Carta lleva la hoja completa (los tres papeles embebidos, como la
  // usa la app): así también se comprueba que las secciones ocultas no se
  // imprimen —si el CSS del selector fallara, saldrían tres juegos de páginas—.
  // Los otros dos van con un solo papel para no pagar el render de los tres.
  { papel: 'carta', etiquetas: ETIQUETAS_POR_CASO, columnas: COLUMNAS_POR_CASO, todosLosPapeles: true },
  { papel: 'a4', etiquetas: ETIQUETAS_POR_CASO, columnas: COLUMNAS_POR_CASO },
  { papel: 'oficio', etiquetas: ETIQUETAS_POR_CASO, columnas: COLUMNAS_POR_CASO },
];

const args = process.argv.slice(2);
const exigir = args.includes('--exigir');
const indiceGuardar = args.indexOf('--guardar');
const guardarEn = indiceGuardar >= 0 ? resolve(args[indiceGuardar + 1] ?? '') : null;
const chromePedido = args.includes('--chrome') ? args[args.indexOf('--chrome') + 1] : null;

// --- Arranque: Node ejecutando TypeScript y resolviendo el alias `@/` ---
// Los imports son dinámicos a propósito: un `import` estático del código de src/
// se evaluaría antes de este bloque y fallaría con una versión de Node que no
// ejecute TypeScript.
function avisarSinEntorno(motivo) {
  if (exigir) {
    console.error(`✘ no se pudo verificar la impresión: ${motivo}`);
    process.exit(1);
  }
  console.log(`· verificación de impresión salteada: ${motivo}`);
  process.exit(0);
}

function relanzarSiHaceFalta() {
  if (process.env.FABLAB_CARGADOR) return;
  const [mayor, menor] = process.versions.node.split('.').map(Number);
  if (mayor < 22 || (mayor === 22 && menor < 6)) {
    avisarSinEntorno(`Node ${process.versions.node} no puede ejecutar TypeScript (hace falta ≥ 22.6)`);
    return;
  }
  // Node avisa que src/*.ts no declara tipo de módulo; es ruido para un chequeo
  // que se corre en cada gate.
  const banderas = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'];
  if (!process.features?.typescript) {
    banderas.push('--experimental-strip-types', '--disable-warning=ExperimentalWarning');
  }
  banderas.push('--import', `${CARPETA}cargador-ts.mjs`, ...process.argv.slice(1));
  const hijo = spawnSync(process.execPath, banderas, {
    stdio: 'inherit',
    env: { ...process.env, FABLAB_CARGADOR: '1' },
  });
  process.exit(hijo.status ?? 1);
}

relanzarSiHaceFalta();

const { planHojaEtiquetas } = await import('../src/lib/data-matrix-svg.ts');
const { hojasImprimibles, htmlHojaImprimible } = await import('../src/lib/hoja-imprimible.ts');
const { encodeToMatrix } = await import('datamatrix-svg-ts');

// --- Navegador ---
const CANDIDATOS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'brave-browser',
  'microsoft-edge',
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function versionDe(comando) {
  const r = spawnSync(comando, ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim() || 'ok';
}


// `--chrome <ruta>` y `CHROME_BIN` fuerzan el navegador: si se pasan, no se busca
// ningún otro (así se puede comprobar que el chequeo avisa cuando no hay, en vez
// de encontrar el del sistema por casualidad).
function encontrarNavegador() {
  const forzado = chromePedido ?? process.env.CHROME_BIN;
  const candidatos = forzado ? [forzado] : CANDIDATOS;
  for (const comando of candidatos) {
    const version = versionDe(comando);
    if (version) return { comando, version };
  }
  return null;
}

const navegador = encontrarNavegador();
if (!navegador) {
  avisarSinEntorno('no se encontró Chrome/Chromium (definí CHROME_BIN o pasá --chrome <ruta>)');
}

// --- Hoja HTML → PDF ---
// La hoja embebe los tres papeles y arranca en Carta; para probar otro papel se
// mueve el `selected` del <select>, que es exactamente lo que hace pintarPapel()
// al cambiar el selector: no hay camino especial para la prueba.
function conPapelInicial(html, papel) {
  return html
    .replace(/<option value="(\w+)" selected>/, '<option value="$1">')
    .replace(new RegExp(`<option value="${papel}">`), `<option value="${papel}" selected>`);
}

// La propia hoja abre el diálogo al cargar. En headless no aporta nada y puede
// interferir con --print-to-pdf, así que se quita de la copia de prueba; si el
// texto cambia, esto avisa en vez de probar otra cosa sin enterarse.
function sinAutoImpresion(html) {
  const quitado = html.replace(/setTimeout\(function \(\) \{ window\.print\(\); \}, \d+\);/, '');
  if (quitado === html) throw new Error('la hoja ya no imprime sola: revisá sinAutoImpresion()');
  return quitado;
}

// Las hojas se imprimen **en serie**: con `--user-data-dir` propio (que es lo que
// haría falta para paralelizar) un perfil nuevo deja a Brave colgado esperando su
// flujo de primera ejecución, y sin él las instancias se pelean por el perfil del
// usuario. El timeout es para que un navegador que se cuelga falle el chequeo en
// vez de colgar el gate entero.
async function imprimirAPdf(html, pdf) {
  const banderas = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-pdf-header-footer',
    '--virtual-time-budget=15000',
    `--print-to-pdf=${pdf}`,
    pathToFileURL(html).href,
  ];
  let ultimoError = '';
  // `--headless=new` en Chrome recientes y `--headless` en los viejos.
  for (const headless of ['--headless=new', '--headless']) {
    try {
      await ejecutar(navegador.comando, [headless, ...banderas], {
        maxBuffer: 8 << 20,
        timeout: 120_000,
        killSignal: 'SIGKILL',
      });
    } catch (e) {
      ultimoError = String(e?.message ?? e).slice(0, 300);
    }
    if (existsSync(pdf)) return;
  }
  throw new Error(
    ultimoError
      ? `el navegador no generó el PDF: ${ultimoError}`
      : 'el comando salió sin error pero no dejó ningún PDF (¿es un navegador?)',
  );
}

// --- Casos ---
// Códigos deterministas de tres largos: el más largo (15 caracteres) es el que
// fija el ancho de celda —tanto que la celda la decide el texto y no el símbolo—,
// así que la grilla es la más apretada posible, que es el caso que más se acerca
// a cortar.
function codigosDePrueba(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => {
    if (i % 3 === 0) return `IOT-${100 + i}`;
    if (i % 3 === 1) return `IMP3D-${100 + i}`;
    return `FL-M${String(i).padStart(11, '0')}`;
  });
}

const carpeta = guardarEn ?? mkdtempSync(join(tmpdir(), 'fablab-impresion-'));
mkdirSync(carpeta, { recursive: true });

console.log('Verificación de impresión de la hoja de etiquetas');
console.log(`  navegador: ${navegador.comando} (${navegador.version})`);
console.log(`  el borde son los últimos ${BANDA_MM} mm de cada hoja`);
console.log(`  archivos: ${carpeta}`);

const hojas = [];
for (const pedido of PEDIDOS) {
  try {
    const etiquetas = codigosDePrueba(pedido.etiquetas).map((codigo) => ({
      codigo,
      matriz: encodeToMatrix(codigo),
    }));
    // Mismas opciones para el plan y para la hoja: si difieren, el chequeo
    // compara el PDF contra un plan que no es el que se imprimió.
    const opciones = { papel: pedido.papel, columnas: pedido.columnas };
    const plan = planHojaEtiquetas(etiquetas, opciones);
    const variantes = hojasImprimibles(etiquetas, opciones).filter(
      (h) => pedido.todosLosPapeles || h.papel === pedido.papel,
    );
    const hoja = variantes.find((h) => h.papel === pedido.papel);
    const html = conPapelInicial(
      sinAutoImpresion(
        htmlHojaImprimible(variantes, etiquetas.length, `etiquetas-${pedido.papel}.svg`, '#'),
      ),
      pedido.papel,
    );
    const rutaHtml = join(carpeta, `hoja-${pedido.papel}.html`);
    const rutaPdf = join(carpeta, `hoja-${pedido.papel}.pdf`);
    writeFileSync(rutaHtml, html);
    await imprimirAPdf(rutaHtml, rutaPdf);
    hojas.push({ hoja, plan, rutaPdf });
  } catch (e) {
    // Un navegador que no imprime (o que no es un navegador) falla el chequeo con
    // un mensaje, no con un volcado de pila.
    hojas.push({ hoja: { nombre: pedido.papel.toUpperCase() }, plan: null, error: String(e?.message ?? e) });
  }
}

let controles = 0;
let fallos = 0;
function bien(titulo) {
  controles++;
  console.log(`  ✔ ${titulo}`);
}
function mal(titulo, detalle) {
  controles++;
  fallos++;
  console.log(`  ✘ ${titulo}: ${detalle}`);
}

function mm(pt) {
  return `${(pt / PT_POR_MM).toFixed(1)} mm`;
}

for (const { plan, hoja, rutaPdf, error } of hojas) {
  if (error) {
    mal(`no se pudo imprimir la hoja de ${hoja.nombre}`, error);
    continue;
  }
  const titulo = `${hoja.nombre} · ${plan.medidas.length} etiquetas (${plan.columnas} × ${plan.filasPorPagina} por hoja)`;
  const paginas = paginasDelPdf(readFileSync(rutaPdf));

  if (paginas.length !== plan.paginas.length) {
    mal(
      titulo,
      `el PDF tiene ${paginas.length} páginas y el plan ${plan.paginas.length}: el navegador partió por donde no debía`,
    );
    continue;
  }
  bien(`${titulo}: ${paginas.length} páginas, como el plan`);

  const desviada = paginas.find(
    (p) =>
      Math.abs((p.anchoPt ?? 0) / PT_POR_MM - hoja.anchoMm) >= 1 ||
      Math.abs((p.altoPt ?? 0) / PT_POR_MM - hoja.altoMm) >= 1,
  );
  if (desviada) {
    mal(
      `${hoja.nombre}: tamaño de hoja`,
      `el PDF mide ${desviada.anchoPt} × ${desviada.altoPt} pts y se esperaba ` +
        `${hoja.anchoMm} × ${hoja.altoMm} mm (el @page no se aplicó)`,
    );
  } else {
    bien(
      `${hoja.nombre}: cada hoja mide ${(paginas[0].anchoPt / PT_POR_MM).toFixed(1)} × ` +
        `${(paginas[0].altoPt / PT_POR_MM).toFixed(1)} mm, como el papel pedido`,
    );
  }

  paginas.forEach((pagina, i) => {
    if (!pagina.tinta) {
      mal(`${hoja.nombre} · página ${i + 1}`, 'la hoja salió vacía');
      return;
    }
    const margenes = {
      izquierda: pagina.tinta.x0,
      derecha: pagina.anchoPt - pagina.tinta.x1,
      superior: pagina.altoPt - pagina.tinta.y1,
      inferior: pagina.tinta.y0,
    };
    const minimo = Math.min(...Object.values(margenes));
    const detalle = Object.entries(margenes)
      .map(([lado, valor]) => `${lado} ${mm(valor)}`)
      .join(' · ');
    if (minimo >= BANDA_MM * PT_POR_MM) {
      bien(`${hoja.nombre} · página ${i + 1}: tinta dentro del área imprimible (${detalle})`);
    } else {
      mal(
        `${hoja.nombre} · página ${i + 1}: tinta a ${mm(minimo)} del borde`,
        `una etiqueta quedó cortada por el paginado (${detalle})`,
      );
    }
  });
}

console.log(`\n${controles - fallos}/${controles} controles OK`);
if (!guardarEn) {
  // Sin --guardar el directorio es temporal: no se deja basura en el repo.
  rmSync(carpeta, { recursive: true, force: true });
}
process.exit(fallos ? 1 : 0);
