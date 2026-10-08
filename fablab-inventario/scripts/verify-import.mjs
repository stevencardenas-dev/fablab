// Verificación de la importación de inventario (CSV y Excel) contra MySQL real.
// Usa una base propia (fablab_verify), la recrea desde ddl-data.sql y la borra al
// final. Nunca toca la base de producción ni la local 'fablab'.
// Correr: node scripts/verify-import.mjs
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DB = 'fablab_verify';
const PUERTO = 34519;
const TOKEN = 'verify-token';
const base = { host: '127.0.0.1', port: 13306, user: 'root', password: 'fablab', multipleStatements: true };
const cfg = { ...base, database: DB };
const { importarElementos, importarArchivo, filasDeHoja, claveDeSala, listarElementos, asegurarCodigoUnico, cerrarPools, ErrorApi } =
  await import(`${RAIZ}importer/api.mjs`);

let ok = 0;
const fallos = [];
async function caso(nombre, fn) {
  try {
    await fn();
    ok++;
    console.log(`  ok    ${nombre}`);
  } catch (e) {
    fallos.push(nombre);
    console.log(`  FAIL  ${nombre}\n        ${e.message.split('\n').join('\n        ')}`);
  }
}

// --- base de prueba ---
const admin = await mysql.createConnection(base);
await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await admin.end();
const carga = await mysql.createConnection(cfg);
await carga.query(readFileSync(`${RAIZ}ddl-data.sql`, 'utf8'));
await carga.end();
const db = await mysql.createConnection(cfg);
// Igual que al arrancar el servidor: la base de prueba tiene el UNIQUE de producción.
await asegurarCodigoUnico(cfg);
const sql = async (q, p) => (await db.query(q, p))[0];
const idSala = async (nombre, edificio) =>
  (await sql('SELECT s.id FROM salas s JOIN edificios e ON e.id = s.edificio_id WHERE s.nombre = ? AND e.nombre = ?', [nombre, edificio]))[0].id;
const CNC = await idSala('CNC', 'FabLab');
const AULA303 = await idSala('Aula 303', 'ViveLab');
const enBase = async (codigo) => (await sql('SELECT * FROM elementos WHERE codigo = ?', [codigo]))[0];
const existente = (await sql('SELECT codigo FROM elementos WHERE codigo IS NOT NULL ORDER BY id LIMIT 1'))[0].codigo;

// --- CSV ---
const H = 'id,sala,edificio,codigo,detalle,serial,inventario,estado,cantidad,observaciones';
const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const fila = (o) => [
  '', o.sala ?? 'CNC', o.edificio ?? 'FabLab', o.codigo, o.detalle ?? '', o.serial ?? '',
  o.inventario ?? '', o.estado ?? '', o.cantidad ?? '', o.observaciones ?? '',
].map(q).join(',');
const csv = (...filas) => [H, ...filas].join('\n');

console.log('CSV');
await caso('filas nuevas se importan', async () => {
  const r = await importarElementos(csv(fila({ codigo: 'V-001', detalle: 'Mesa' }), fila({ codigo: 'V-002', detalle: 'Silla' })), cfg);
  assert.equal(r.importados, 2);
  assert.equal((await enBase('V-002')).detalle, 'Silla');
});
await caso('comillas, comas y punto y coma se conservan', async () => {
  await importarElementos(csv(fila({ codigo: 'V-003', detalle: 'Caja, "grande"', serial: 'A;B' })), cfg);
  const e = await enBase('V-003');
  assert.equal(e.detalle, 'Caja, "grande"');
  assert.equal(e.serial, 'A;B');
});
await caso('BOM, CRLF y líneas en blanco no rompen el archivo', async () => {
  const texto = `﻿${H}\r\n${fila({ codigo: 'V-004', detalle: 'Lámpara' })}\r\n\r\n\r\n`;
  assert.equal((await importarElementos(texto, cfg)).importados, 1);
  assert.equal((await enBase('V-004')).detalle, 'Lámpara');
});
await caso('NULL escrito en la celda y celda vacía quedan como NULL', async () => {
  await importarElementos(csv(fila({ codigo: 'V-005', detalle: 'NULL', serial: '' })), cfg);
  const e = await enBase('V-005');
  assert.equal(e.detalle, null);
  assert.equal(e.serial, null);
});
await caso('código que ya existe se omite y se reporta', async () => {
  const r = await importarElementos(csv(fila({ codigo: existente, detalle: 'X' })), cfg);
  assert.equal(r.importados, 0);
  assert.equal(r.omitidos[0].motivo, 'código ya existe');
});
await caso('código repetido en el mismo archivo y con otras mayúsculas: el segundo se omite', async () => {
  const r = await importarElementos(csv(fila({ codigo: 'V-006' }), fila({ codigo: 'v-006' })), cfg);
  assert.equal(r.importados, 1);
  assert.deepEqual(r.omitidos.map((o) => [o.fila, o.motivo]), [[3, 'código ya existe']]);
});
await caso('sala desconocida se omite con su motivo', async () => {
  const r = await importarElementos(csv(fila({ codigo: 'V-007', sala: 'Narnia' })), cfg);
  assert.equal(r.importados, 0);
  assert.match(r.omitidos[0].motivo, /^sala no existe: FabLab \/ Narnia$/);
});
await caso('sala y edificio sin mayúsculas, y prefijo VIVE LAB, encuentran la sala', async () => {
  await importarElementos(csv(fila({ codigo: 'V-008', sala: 'cnc', edificio: 'FABLAB' })), cfg);
  assert.equal((await enBase('V-008')).sala_id, CNC);
  await importarElementos(csv(fila({ codigo: 'V-009', sala: 'VIVE LAB-AULA 303', edificio: 'ViveLab' })), cfg);
  assert.equal((await enBase('V-009')).sala_id, AULA303);
});
await caso('código de más de 64 caracteres se omite sin abortar el lote', async () => {
  const largo = 'L'.repeat(65);
  const r = await importarElementos(csv(fila({ codigo: largo }), fila({ codigo: 'V-010' })), cfg);
  assert.equal(r.importados, 1);
  assert.match(r.omitidos[0].motivo, /^codigo supera 64/);
});
await caso('observaciones de más de 255 caracteres se omiten; las demás filas entran', async () => {
  const r = await importarElementos(csv(fila({ codigo: 'V-011', observaciones: 'o'.repeat(256) }), fila({ codigo: 'V-012' })), cfg);
  assert.equal(r.importados, 1);
  assert.match(r.omitidos[0].motivo, /^observaciones supera 255/);
  assert.ok(await enBase('V-012'));
});
await caso('texto con acentos, espacios alrededor del código y cantidad no numérica', async () => {
  await importarElementos(csv(fila({ codigo: '  V-013  ', detalle: 'Bisturí de precisión', cantidad: 'INCONTABLE' })), cfg);
  const e = await enBase('V-013');
  assert.equal(e.detalle, 'Bisturí de precisión');
  assert.equal(e.cantidad, 'INCONTABLE');
});
await caso('falta la columna codigo → error 400', async () => {
  await assert.rejects(importarElementos('sala,edificio,detalle\nCNC,FabLab,x', cfg), (e) => e instanceof ErrorApi && e.status === 400);
});
await caso('archivo sin filas → error 400', async () => {
  await assert.rejects(importarElementos(H, cfg), (e) => e instanceof ErrorApi && e.status === 400);
});
await caso('volver a importar lo mismo no crea nada', async () => {
  const antes = (await sql('SELECT COUNT(*) AS n FROM elementos'))[0].n;
  const r = await importarElementos(csv(fila({ codigo: 'V-001' }), fila({ codigo: 'V-002' })), cfg);
  assert.equal(r.importados, 0);
  assert.equal((await sql('SELECT COUNT(*) AS n FROM elementos'))[0].n, antes);
});
await caso('lo importado aparece en la lectura de la sala (caché invalidada)', async () => {
  await listarElementos(CNC, cfg);
  await importarElementos(csv(fila({ codigo: 'V-014', detalle: 'Nuevo' })), cfg);
  const elementos = await listarElementos(CNC, cfg);
  assert.ok(elementos.some((e) => e.codigo === 'V-014'), 'V-014 debe aparecer en la sala CNC');
});

// --- Excel ---
const libro = (hojas, tipo = 'xlsx') => {
  const wb = XLSX.utils.book_new();
  for (const [nombre, aoa] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: tipo }));
};
const cabeceraVL = ['CODIGO', 'DETALLE ', 'SERIAL ', 'INVENTARIO ', 'OBSERVACIONES ', 'CANTIDAD '];
console.log('Excel');
await caso('libro: cada hoja va a la sala de su nombre; hojas sin match se reportan', async () => {
  const bytes = libro({
    CNC: [
      ['CODIGO', 'DETALLE ', 'SERIAL ', 'N° INVENTARIO', 'CANTIDAD ', 'OBSERVACION'],
      ['X-1', 'Taladro', '', '70357-1', 2, 'ok'],
      ['', '', '', '', '', ''],
      ['X-2', 'Sierra', '', '', 1, ''],
      ['', 'Sin código', '', '', 1, ''],
    ],
    'VIVE LAB-AULA 303': [cabeceraVL, ['VT-1', 'Monitor', '', '', '', 1], [1234, 'Numérico', '', '', '', 1]],
    Narnia: [cabeceraVL, ['N-1', 'Algo', '', '', '', 1]],
    Vacia: [[]],
    SinCodigo: [['NOMBRE', 'CANTIDAD'], ['Algo', 1]],
  });
  const r = await importarArchivo(bytes, cfg);
  assert.equal(r.importados, 4, `importados=${r.importados}`);
  const hojas = Object.fromEntries(r.hojas.map((h) => [h.hoja, h.sala]));
  assert.deepEqual(hojas, { CNC: 'CNC', 'VIVE LAB-AULA 303': 'Aula 303', Narnia: null, Vacia: null, SinCodigo: null });
  assert.ok(r.omitidos.some((o) => o.hoja === 'CNC' && o.motivo === 'sin código'));
  assert.ok(r.omitidos.some((o) => o.hoja === 'Narnia' && o.motivo === 'ninguna sala se llama así'));
  assert.ok(r.omitidos.some((o) => o.hoja === 'SinCodigo' && o.motivo === 'hoja sin columna CODIGO'));
  assert.ok(r.omitidos.some((o) => o.hoja === 'Vacia' && o.motivo === 'hoja vacía'));
  assert.equal((await enBase('X-1')).inventario, '70357-1', 'N° INVENTARIO se mapea a inventario');
  assert.equal((await enBase('X-1')).cantidad, '2');
  assert.equal((await enBase('1234')).detalle, 'Numérico', 'códigos numéricos llegan como texto');
});
await caso('.xls se importa igual que .xlsx', async () => {
  const bytes = libro({ CNC: [['CODIGO', 'DETALLE'], ['XLS-1', 'Viejo']] }, 'xls');
  assert.equal(bytes[0], 0xd0, 'formato OLE');
  assert.equal((await importarArchivo(bytes, cfg)).importados, 1);
  assert.ok(await enBase('XLS-1'));
});
await caso('.ods se importa igual que .xlsx', async () => {
  const bytes = libro({ CNC: [['CODIGO', 'DETALLE'], ['ODS-1', 'Libre']] }, 'ods');
  assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'formato zip');
  assert.equal((await importarArchivo(bytes, cfg)).importados, 1);
  assert.ok(await enBase('ODS-1'));
});
await caso('CSV llegado como bytes también funciona', async () => {
  const bytes = Buffer.from(csv(fila({ codigo: 'B-1', detalle: 'Bytes' })), 'utf8');
  assert.equal((await importarArchivo(bytes, cfg)).importados, 1);
});
await caso('archivo corrupto con cabecera zip → error 400 claro', async () => {
  await assert.rejects(importarArchivo(Buffer.from('PK\x03\x04basura-no-es-zip'), cfg), (e) => e instanceof ErrorApi && e.status === 400);
});
await caso('la misma hoja de dos archivos no duplica (segunda vez: código ya existe)', async () => {
  const bytes = libro({ CNC: [['CODIGO', 'DETALLE'], ['DUP-1', 'Uno']] });
  assert.equal((await importarArchivo(bytes, cfg)).importados, 1);
  const r = await importarArchivo(bytes, cfg);
  assert.equal(r.importados, 0);
  assert.equal(r.omitidos[0].motivo, 'código ya existe');
});
await caso('hoja con columnas sala y edificio (CSV abierto en Excel) usa esas columnas, aunque el nombre no coincida', async () => {
  const bytes = libro({ Hoja1: [['codigo', 'sala', 'edificio', 'detalle'], ['EX-1', 'Aula 303', 'ViveLab', 'Por columna']] });
  const r = await importarArchivo(bytes, cfg);
  assert.equal(r.importados, 1);
  assert.equal((await enBase('EX-1')).sala_id, AULA303);
});
await caso('nombre de hoja que coincide sin distinguir tildes ni mayúsculas', async () => {
  assert.equal(claveDeSala('VIVE LAB-BODEGA '), claveDeSala('Bodega'));
  assert.equal(claveDeSala('Área'), claveDeSala('AREA'));
  assert.equal(filasDeHoja(XLSX.utils.aoa_to_sheet([['CODIGO'], [''], ['']])).length, 0, 'filas en blanco no cuentan');
});

// --- HTTP: el endpoint real, con token ---
console.log('HTTP');
const servidor = spawn(process.execPath, [`${RAIZ}server/index.mjs`], {
  env: { ...process.env, MYSQL_DATABASE: DB, MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '13306', PORT: String(PUERTO), API_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
servidor.stdout.on('data', (d) => (salida += d));
servidor.stderr.on('data', (d) => (salida += d));
const url = `http://127.0.0.1:${PUERTO}`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* aún no escucha */ }
  await esperar(250);
}
const post = (cuerpo, token = TOKEN) => fetch(`${url}/api/import/elementos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
await caso('sin token → 401', async () => assert.equal((await post({ csv: csv() }, null)).status, 401));
await caso('token incorrecto → 401', async () => assert.equal((await post({ csv: csv() }, 'otro')).status, 401));
await caso('sin archivo ni csv → 400', async () => {
  const r = await post({});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /archivo es obligatorio/);
});
await caso('JSON roto → 400 (no 500)', async () => assert.equal((await post('{no es json')).status, 400));
await caso('csv con fila nueva → 200 y la fila está en la base', async () => {
  const r = await post({ csv: csv(fila({ codigo: 'H-1', detalle: 'Por HTTP' })) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).importados, 1);
  assert.equal((await enBase('H-1')).detalle, 'Por HTTP');
});
await caso('libro de Excel en base64 → 200', async () => {
  const bytes = libro({ CNC: [['CODIGO', 'DETALLE'], ['H-2', 'Desde Excel']] });
  const r = await post({ archivo: bytes.toString('base64') });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).importados, 1);
});
await caso('archivo corrupto en base64 → 400', async () => {
  const r = await post({ archivo: Buffer.from('PK\x03\x04basura').toString('base64') });
  assert.equal(r.status, 400);
});
await caso('cuerpo de 5 MB → 413 (tope 4 MB del import)', async () => {
  const grande = JSON.stringify({ csv: 'a'.repeat(5 * 1024 * 1024) });
  const estado = await new Promise((resolver, rechazar) => {
    let status = null;
    const req = http.request(`${url}/api/import/elementos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(grande) },
    }, (res) => { status = res.statusCode; res.resume(); res.on('end', () => resolver(status)); });
    req.on('error', (e) => (status ? resolver(status) : rechazar(e)));
    req.end(grande);
  });
  assert.equal(estado, 413);
});
await caso('lo que exporta la API se puede volver a importar (ida y vuelta)', async () => {
  const exporta = await fetch(`${url}/api/export/elementos.csv`);
  const texto = await exporta.text();
  const r = await post({ csv: texto });
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.importados, 0, 'todo lo exportado ya existe o no tiene código');
  assert.ok(cuerpo.omitidos.length > 0);
  assert.ok(cuerpo.omitidos.every((o) => ['código ya existe', 'sin código'].includes(o.motivo)), JSON.stringify(cuerpo.omitidos.slice(0, 3)));
});
await caso('lectura de salas y export siguen funcionando', async () => {
  assert.equal((await fetch(`${url}/api/salas`)).status, 200);
  assert.equal((await fetch(`${url}/api/export/elementos.csv`)).status, 200);
});
servidor.kill();

// --- limpieza ---
await db.end();
await cerrarPools();
await esperar(300);
const limpia = await mysql.createConnection(base);
await limpia.query(`DROP DATABASE IF EXISTS ${DB}`);
await limpia.end();

console.log(`\n${ok} ok, ${fallos.length} fallos`);
if (fallos.length) {
  console.log('Fallaron:', fallos.join(' | '));
  console.log('Salida del servidor (últimas líneas):\n' + salida.split('\n').slice(-15).join('\n'));
  process.exit(1);
}
