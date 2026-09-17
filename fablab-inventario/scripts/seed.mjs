#!/usr/bin/env node
// seed.mjs — Importa el inventario real (xlsx) al MySQL de Docker, en un solo paso.
//
// Genera el SQL del esquema normalizado (importer/normalizado.mjs, mismas 11 hojas
// de HOJAS) y lo carga en el contenedor `fablab-mysql` con charset utf8mb4 en el
// cliente mysql — sin eso los acentos salen mojibake (LÃ¡ser en vez de Láser).
//
// Uso:
//   npm run seed -- <archivo.xlsx>                        # importa las hojas de HOJAS presentes
//   npm run seed -- <archivo.xlsx> --hojas "CNC 2026,ALMACEN 2026"
//   npm run seed -- <archivo.xlsx> --listar               # hojas del archivo (nombre/filas/columnas)
//   npm run seed -- <archivo.xlsx> --sql-only             # imprime el SQL, no toca la base
//   npm run seed -- <archivo.xlsx> --sin-docker           # MySQL local por TCP en vez del contenedor
//
// La importacion SIEMPRE vacia la base (DDL con DROP TABLE), como los demas
// importadores del repo: una reimportacion pisa ediciones hechas a mano.
//
// Conexion/contenedor (variables de entorno):
//   MYSQL_CONTAINER (default fablab-mysql), MYSQL_HOST, MYSQL_PORT (default 13306),
//   MYSQL_USER (root), MYSQL_PASSWORD (fablab), MYSQL_DATABASE (fablab)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import XLSX from 'xlsx';
import { generarSQL, HOJAS } from '../importer/normalizado.mjs';
import { hojasDisponibles } from '../importer/schema.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const tiene = (n) => args.includes(n);

const archivo = flag('--archivo') || args.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: npm run seed -- <archivo.xlsx> [--hojas "A,B"] [--listar] [--sql-only] [--sin-docker]');
  process.exit(1);
}
if (!existsSync(archivo)) {
  console.error(`Error: no existe el archivo "${archivo}"`);
  process.exit(1);
}

const MYSQL_CONTAINER = process.env.MYSQL_CONTAINER || 'fablab-mysql';
const DB = process.env.MYSQL_DATABASE || 'fablab';
const USER = process.env.MYSQL_USER || 'root';
const PASSWORD = process.env.MYSQL_PASSWORD || 'fablab';
const CHARSET = 'utf8mb4';

// ─── 1. Leer el workbook ───
let workbook;
try {
  workbook = XLSX.readFile(archivo);
} catch (e) {
  console.error(`Error leyendo el xlsx: ${e.message}`);
  process.exit(1);
}

if (tiene('--listar')) {
  console.log('nombre\tfilas\tcolumnas');
  for (const h of hojasDisponibles(workbook)) {
    console.log(`${h.nombre}\t${h.filas} filas\t${h.columnas} columnas`);
  }
  process.exit(0);
}

// ─── 2. Resolver qué hojas importar (subset de HOJAS presente en el archivo) ───
const enHOJAS = HOJAS.filter((h) => workbook.SheetNames.includes(h.nombre));
const faltanMapa = workbook.SheetNames.filter((n) => n.trim() && !HOJAS.some((h) => h.nombre === n));

let hojas = enHOJAS;
const pedidas = flag('--hojas');
if (pedidas) {
  // trim() en ambos lados: 'VIVE LAB-BODEGA ' tiene espacio final en el xlsx y es facil de perder al escribir.
  const nombres = pedidas.split(',').map((s) => s.trim()).filter(Boolean);
  const desconocidas = nombres.filter((n) => !HOJAS.some((h) => h.nombre.trim() === n));
  if (desconocidas.length) {
    console.error(`Error: hojas fuera del mapa HOJAS (importer/normalizado.mjs): ${desconocidas.join(', ')}`);
    console.error(`Hojas mapeadas: ${HOJAS.map((h) => h.nombre.trim()).join(' | ')}`);
    process.exit(1);
  }
  hojas = HOJAS.filter((h) => nombres.includes(h.nombre.trim()));
}
if (!hojas.length) {
  console.error('Error: el archivo no tiene ninguna hoja del mapa HOJAS.');
  console.error('Hojas disponibles en el archivo:');
  for (const h of hojasDisponibles(workbook)) console.error(`  - ${h.nombre} (${h.filas} filas)`);
  if (faltanMapa.length) {
    console.error('Hojas presentes pero sin mapear edificio/sala (agregarlas a HOJAS):');
    for (const n of faltanMapa) console.error(`  ? ${n}`);
  }
  process.exit(1);
}

// ─── 3. Generar el SQL normalizado ───
const sql = generarSQL(workbook, hojas);

if (tiene('--sql-only')) {
  process.stdout.write(sql + '\n');
  process.exit(0);
}

// ─── 4. Cargar en MySQL ───
async function cargarDirecto() {
  const mysql = await import('mysql2/promise');
  const { conexionDesdeEnv } = await import('../importer/importar.mjs');
  const cfg = conexionDesdeEnv(); // mysql2 habla utf8mb4 por defecto: acentos seguros
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

function cargarConDocker() {
  if (spawnSync('docker', ['ps'], { encoding: 'utf8' }).status !== 0) {
    console.error('Error: docker no esta disponible. ¿Instalaste e iniciaste Docker Desktop?');
    console.error('Alternativa sin Docker: npm run seed -- <archivo.xlsx> --sin-docker');
    process.exit(1);
  }
  const nombres = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (!(nombres.stdout || '').split(/\r?\n/).includes(MYSQL_CONTAINER)) {
    console.error(`Error: el contenedor "${MYSQL_CONTAINER}" no esta corriendo.`);
    console.error('Levantalo con: docker compose up -d  (en la raiz del repo fablab)');
    process.exit(1);
  }
  const r = spawnSync(
    'docker',
    ['exec', '-i', MYSQL_CONTAINER, 'mysql', `--default-character-set=${CHARSET}`,
      '-u', USER, `-p${PASSWORD}`, DB],
    { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    const err = (r.stderr || '').split('\n').filter((l) => !/^mysql: \[Warning\]/.test(l)).join('\n');
    console.error(`Error cargando SQL en ${MYSQL_CONTAINER}:\n${err}`);
    process.exit(1);
  }
}

try {
  if (tiene('--sin-docker')) await cargarDirecto();
  else cargarConDocker();
} catch (e) {
  console.error(`Error cargando en MySQL: ${e.message}`);
  process.exit(1);
}

// ─── 5. Resumen ───
for (const h of hojas) {
  const n = hojasDisponibles(workbook).find((x) => x.nombre === h.nombre)?.filas ?? 0;
  console.log(`  ${h.edificio} / ${h.sala}  <-  "${h.nombre.trim()}" (${n} filas)`);
}

async function conteos() {
  if (tiene('--sin-docker')) {
    const mysql = await import('mysql2/promise');
    const { conexionDesdeEnv } = await import('../importer/importar.mjs');
    const conn = await mysql.createConnection(conexionDesdeEnv());
    const [filas] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM edificios) AS edificios,
              (SELECT COUNT(*) FROM salas) AS salas,
              (SELECT COUNT(*) FROM elementos) AS elementos`,
    );
    await conn.end();
    return filas[0];
  }
  const r = spawnSync(
    'docker',
    ['exec', MYSQL_CONTAINER, 'mysql', `--default-character-set=${CHARSET}`, '-u', USER,
      `-p${PASSWORD}`, '-N', '-e',
      'SELECT CONCAT(COUNT(*),"|",(SELECT COUNT(*) FROM salas),"|",(SELECT COUNT(*) FROM elementos)) FROM edificios;',
      DB],
    { encoding: 'utf8' },
  );
  const [e, s, el] = (r.stdout || '').split('\n').find((l) => l.includes('|'))?.trim().split('|') ?? [];
  return { edificios: e, salas: s, elementos: el };
}

const c = await conteos();
console.log(`Base "${DB}": ${c.edificios} edificios, ${c.salas} salas, ${c.elementos} elementos.`);
console.log('Listo. La app deberia mostrar el inventario real (recargar la pantalla Inventario).');
