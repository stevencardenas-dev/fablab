#!/usr/bin/env node
// verificar-docs.mjs — chequeos que no cubre ni tsc ni Jest, porque miran
// archivos que el compilador no toca: el markdown y los scripts .mjs.
//
//   1. Todos los enlaces relativos de docs/ y los README resuelven a archivos
//      que existen (un doc que apunta a la nada es peor que no tener doc).
//   2. La tabla de rutas de docs/api.md coincide con lo que el server expone:
//      cada ruta documentada tiene evidencia en server/index.mjs y el conteo
//      que declara el propio documento no se contradice.
//   3. Todo .mjs de server/, importer/ y scripts/ pasa `node --check` (el
//      compilador de TypeScript no los ve; un script roto se descubre tarde).
//   4. Los archivos de tipos que un CLON LIMPIO necesita están versionados: si
//      `expo-env.d.ts` falta (o está en .gitignore), `tsc` pasa en la máquina que
//      lo generó y falla en CI. Fue el primer fallo real del workflow.
//
// Uso:  node scripts/verificar-docs.mjs        (npm run docs:check)
// Sale con código 1 si algo falla: es un gate de CI, no un informe.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ_MONOREPO = path.dirname(RAIZ_APP);

let fallos = 0;
let controles = 0;

function bien(titulo) {
  controles++;
  console.log(`  ✔ ${titulo}`);
}
function mal(titulo, detalle) {
  controles++;
  fallos++;
  console.log(`  ✘ ${titulo}: ${detalle}`);
}

// --- 1. Enlaces relativos ---
function docsAMirar() {
  const docs = readdirSync(path.join(RAIZ_APP, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(RAIZ_APP, 'docs', f));
  return [
    ...docs,
    path.join(RAIZ_APP, 'README.md'),
    path.join(RAIZ_MONOREPO, 'README.md'),
    path.join(RAIZ_MONOREPO, 'README-SERVER.md'),
  ].filter((f) => existsSync(f));
}

function verificarEnlaces() {
  let total = 0;
  const rotos = [];
  for (const archivo of docsAMirar()) {
    const texto = readFileSync(archivo, 'utf8');
    for (const m of texto.matchAll(/\]\(([^)\s]+)\)/g)) {
      const enlace = m[1];
      if (/^(https?:|mailto:|#)/.test(enlace)) continue;
      total++;
      const destino = path.resolve(path.dirname(archivo), enlace.split('#')[0]);
      if (!existsSync(destino)) rotos.push(`${path.relative(RAIZ_MONOREPO, archivo)} → ${enlace}`);
    }
  }
  if (rotos.length) {
    mal(`enlaces relativos (${total} revisados)`, `${rotos.length} roto(s):\n      ${rotos.join('\n      ')}`);
  } else {
    bien(`enlaces relativos de docs/ y README (${total}) resuelven`);
  }
}

// --- 2. La doc de la API y el server no se contradicen ---
function verificarRutasDocumentadas() {
  const doc = readFileSync(path.join(RAIZ_APP, 'docs', 'api.md'), 'utf8');
  const server = readFileSync(path.join(RAIZ_APP, 'server', 'index.mjs'), 'utf8');

  // Filas de la tabla: | 12 | POST | `/api/elementos/:id/codigo` | ... |
  const rutas = [...doc.matchAll(/^\|\s*\d+\s*\|\s*(?:GET|POST|PUT|DELETE)(?:·HEAD)?\s*\|\s*`([^`]+)`/gm)]
    .map((m) => m[1]);
  if (rutas.length < 10) {
    mal('tabla de rutas de docs/api.md', `solo se reconocieron ${rutas.length} rutas: ¿cambió el formato de la tabla?`);
    return;
  }

  const declarado = /(\d+)\s+rutas HTTP/.exec(doc);
  if (declarado && Number(declarado[1]) !== rutas.length) {
    mal('conteo de rutas', `docs/api.md dice ${declarado[1]} rutas y la tabla tiene ${rutas.length}`);
  } else {
    bien(`docs/api.md: ${rutas.length} rutas en la tabla${declarado ? ` (coincide con "${declarado[0]}")` : ''}`);
  }

  const sinEvidencia = [];
  for (const ruta of rutas) {
    // Último segmento literal (sin :param, sin {alternativas} y sin el
    // sufijo de query, p. ej. `foto[?tam=miniatura]` → `foto`).
    const segmentos = ruta.split('[')[0].split('/').filter(Boolean)
      .filter((s) => !s.startsWith(':') && !s.includes('{'));
    const ultimo = segmentos[segmentos.length - 1];
    if (!ultimo) continue;
    // En el server cada segmento se compara como string literal.
    const evidencia = new RegExp(`'[^']*${ultimo}[^']*'`).test(server);
    if (!evidencia) sinEvidencia.push(`${ruta} (buscaba '${ultimo}')`);
  }
  if (sinEvidencia.length) {
    mal('rutas documentadas sin respaldo en server/index.mjs', sinEvidencia.join(', '));
  } else {
    bien('cada ruta documentada tiene respaldo en server/index.mjs');
  }

  // El server anuncia sus rutas al arrancar: que esa lista no se quede atrás.
  const anunciadas = [...server.matchAll(/console\.log\(`\s+(?:GET|POST|PUT|DELETE)[^`]*`\)/g)].length;
  if (anunciadas && anunciadas < rutas.length) {
    mal('log de arranque del server', `anuncia ${anunciadas} rutas y la doc documenta ${rutas.length}`);
  } else if (anunciadas) {
    bien(`el log de arranque anuncia ${anunciadas} rutas`);
  }
}

// --- 3. Sintaxis de los .mjs que tsc no compila ---
function archivosMjs(dir) {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d)) {
      const p = path.join(d, entrada);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (p.endsWith('.mjs')) salida.push(p);
    }
  };
  recorrer(path.join(RAIZ_APP, dir));
  return salida;
}

function verificarSintaxis() {
  const archivos = ['server', 'importer', 'scripts'].flatMap(archivosMjs);
  const rotos = [];
  for (const archivo of archivos) {
    try {
      execFileSync(process.execPath, ['--check', archivo], { stdio: 'pipe' });
    } catch (e) {
      rotos.push(`${path.relative(RAIZ_APP, archivo)}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  if (rotos.length) mal(`sintaxis de ${archivos.length} scripts .mjs`, rotos.join('; '));
  else bien(`sintaxis OK en ${archivos.length} scripts .mjs (server/, importer/, scripts/)`);
}

// --- 4. Archivos de tipos que un clon limpio necesita ---
// `expo-env.d.ts` lo genera `npx expo start` y el .gitignore de la plantilla de
// Expo lo ignora; contiene las declaraciones ambientales (`*.css`, `*.module.css`)
// que `tsc` exige. Sin él versionado, el tipo pasa en la máquina de quien lo
// generó y CI falla en un clon limpio (pasó el 2026-09-28).
function verificarTiposVersionados() {
  const archivo = path.join(RAIZ_APP, 'expo-env.d.ts');
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: RAIZ_APP, stdio: 'pipe' });
  } catch {
    bien('expo-env.d.ts: sin repo git, no hay versionado que verificar');
    return;
  }
  if (!existsSync(archivo)) {
    mal('expo-env.d.ts', 'no existe: en un clon limpio `tsc` no encontraría los tipos de `*.css`');
    return;
  }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'expo-env.d.ts'], { cwd: RAIZ_APP, stdio: 'pipe' });
    bien('expo-env.d.ts existe y está versionado (los tipos de CSS que tsc necesita)');
  } catch {
    mal('expo-env.d.ts versionado', 'está en el árbol pero fuera de git: un clon limpio no lo tendría y `tsc` falla en CI');
  }
}

console.log('Verificación de documentación y scripts\n');
verificarEnlaces();
verificarRutasDocumentadas();
verificarSintaxis();
verificarTiposVersionados();

console.log(`\n${controles - fallos}/${controles} controles OK${fallos ? ` · ${fallos} FALLO(S)` : ''}`);
process.exit(fallos ? 1 : 0);
