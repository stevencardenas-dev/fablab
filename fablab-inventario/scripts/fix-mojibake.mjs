#!/usr/bin/env node
// fix-mojibake.mjs — Repara texto con doble codificación UTF-8 ("proyecciÃ³n" → "proyección").
//
// Origen del bug: el dump/CSV de inventario se generó tras cargar el SQL con un
// cliente mysql sin --default-character-set=utf8mb4. Cada carácter acentuado
// quedó guardado como sus 2 bytes UTF-8 leídos como Latin-1 (á → Ã). El dump
// heredó el texto dañado y cualquier re-seed desde él lo propaga.
//
// No usa un roundtrip Latin-1 ciego: el dump tiene MITAD de líneas limpias
// (tablas legacy por hoja) y mitad dañadas (tablas normalizadas). Se reemplaza
// solo la lista cerrada de tokens dobles que aparecen en el texto dañado real,
// y verifica que al final no queden 'Ã'/'Â' sueltos (si quedan, marca la fila
// y aborta con error en vez de corromper más).
//
// Uso:
//   node scripts/fix-mojibake.mjs                     # dry-run: reporta sin escribir
//   node scripts/fix-mojibake.mjs --files             # repara ddl-data.sql + data-elementos.csv
//   node scripts/fix-mojibake.mjs --db                # repara la BD (Docker local por defecto)
//   MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_SSL=1 \
//     node scripts/fix-mojibake.mjs --db --sin-docker # repara una BD remota (Aiven) por TCP
//   node scripts/fix-mojibake.mjs --api               # repara producción vía la API pública (PUT /elementos/:id)
//   node scripts/fix-mojibake.mjs --check             # solo estado (archivos + BD + API), exit 1 si hay mojibake
//
// Tras reparar la BD conviene regenerar dump/CSV desde ella (mysqldump) para
// que la fuente y los artefactos queden iguales.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tokens dobles-UTF8: [dañado, limpio], escritos con \u para que no dependan de
// cómo viajó este archivo (varios incluyen bytes de control, p.ej. Ã­ = C3 AD).
// Cubre el alfabeto español completo, no solo lo visto en el dump.
const TOKENS = [
  ['\u00C3\u00B1', 'ñ'], // Ã±
  ['\u00C3\u0091', 'Ñ'], // Ã‘ (variante Latin-1, char de control)
  ['\u00C3\u2018', 'Ñ'], // Ã‘ (variante CP1252, ' elegantizada)
  ['\u00C3\u00B3', 'ó'], // Ã³
  ['\u00C3\u0093', 'Ó'], // Ã“ (variante Latin-1, char de control)
  ['\u00C3\u201C', 'Ó'], // Ã“ (variante CP1252, " elegantizada)
  ['\u00C3\u00AD', 'í'], // Ã­
  ['\u00C3\u008D', 'Í'], // Ã
  ['\u00C3\u00A1', 'á'], // Ã¡
  ['\u00C3\u0081', 'Á'], // Ã
  ['\u00C3\u00A9', 'é'], // Ã©
  ['\u00C3\u0089', 'É'], // Ã‰
  ['\u00C3\u00BA', 'ú'], // Ãº
  ['\u00C3\u009A', 'Ú'], // Ãš
  ['\u00C3\u00BC', 'ü'], // Ã¼
  ['\u00C3\u009C', 'Ü'], // Ãœ
  ['\u00C2\u00B0', '°'], // Â°
  ['\u00C2\u00BF', '¿'], // Â¿
  ['\u00C2\u00A1', '¡'], // Â¡
];

// Ã y Â sueltos al terminar: residuo no contemplado por el mapa.
const SOSPECHOSOS = /[\u00C3\u00C2]/;

const ARCHIVOS = ['ddl-data.sql', 'data-elementos.csv'];

function repararTexto(texto) {
  let reparado = texto;
  let reemplazos = 0;
  for (const [dan, limpio] of TOKENS) {
    // split/join: reemplazo literal, sin regex (los tokens tienen chars especiales).
    const partes = reparado.split(dan);
    reemplazos += partes.length - 1;
    reparado = partes.join(limpio);
  }
  const residuo = (reparado.match(new RegExp(SOSPECHOSOS.source, 'g')) || []).length;
  return { reparado, reemplazos, residuo };
}

// ─── Modo archivos ───
function repararArchivos(escribir) {
  let total = 0;
  let fallo = false;
  for (const nombre of ARCHIVOS) {
    const ruta = path.join(raiz, nombre);
    const { reparado, reemplazos, residuo } = repararTexto(readFileSync(ruta, 'utf8'));
    const limpioYa = reemplazos === 0;
    console.log(`${nombre}: ${limpioYa ? 'ya limpio ✔' : `${reemplazos} token(s) a reemplazar`}${residuo ? ` — ⚠ ${residuo} 'Ã/Â' sin mapa (NO se toca)` : ''}`);
    if (residuo) fallo = true;
    if (escribir && !limpioYa && !residuo) {
      writeFileSync(ruta, reparado, 'utf8');
      console.log(`  → escrito ${nombre}`);
    }
    total += reemplazos;
  }
  return { total, fallo };
}

// ─── Modo BD ───
// Columnas de texto donde puede vivir el mojibake (todas las tablas del esquema).
const TABLAS = [
  { tabla: 'edificios', pk: 'id', cols: ['nombre'] },
  { tabla: 'salas', pk: 'id', cols: ['nombre'] },
  { tabla: 'elementos', pk: 'id', cols: ['codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'] },
  { tabla: 'traslados', pk: 'id', cols: ['nota'] },
];

function condMojibake(cols) {
  // COLLATE utf8mb4_bin: los collations _ai_ci dan falso positivo (Ã ~ A).
  return cols.map((c) => `\`${c}\` COLLATE utf8mb4_bin REGEXP 'Ã|Â'`).join(' OR ');
}

async function conexionBD() {
  const mysql = await import('mysql2/promise');
  let cfg;
  if (process.argv.includes('--sin-docker')) {
    const { conexionDesdeEnv } = await import('../importer/importar.mjs');
    cfg = conexionDesdeEnv();
  } else {
    // Docker local (mismos defaults que scripts/seed.mjs)
    cfg = {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT) || 13306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || 'fablab',
      database: process.env.MYSQL_DATABASE || 'fablab',
    };
  }
  return mysql.createConnection({ ...cfg, charset: 'utf8mb4' });
}

async function repararBD(escribir) {
  const conn = await conexionBD();
  try {
    let filasTotales = 0;
    let fallo = false;
    for (const { tabla, pk, cols } of TABLAS) {
      const [rows] = await conn.query(
        `SELECT \`${pk}\` AS id, ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${tabla}\` WHERE ${condMojibake(cols)}`,
      );
      if (!rows.length) {
        console.log(`${tabla}: ya limpia ✔`);
        continue;
      }
      let updates = 0;
      for (const row of rows) {
        const set = [];
        const vals = [];
        for (const c of cols) {
          const v = row[c];
          if (v == null) continue;
          const { reparado, reemplazos, residuo } = repararTexto(String(v));
          if (residuo) {
            console.error(`  ⚠ ${tabla}.${pk}=${row.id} columna ${c} tiene 'Ã/Â' sin mapa: ${JSON.stringify(String(v).slice(0, 80))} — fila NO tocada`);
            fallo = true;
            continue;
          }
          if (reemplazos) { set.push(`\`${c}\` = ?`); vals.push(reparado); }
        }
        if (set.length && escribir) {
          await conn.query(`UPDATE \`${tabla}\` SET ${set.join(', ')} WHERE \`${pk}\` = ?`, [...vals, row.id]);
          updates++;
        }
      }
      console.log(`${tabla}: ${rows.length} fila(s) con mojibake${escribir ? ` — ${updates} reparada(s)` : ' (dry-run)'}`);
      filasTotales += rows.length;
    }
    if (!escribir) console.log('(dry-run: para aplicar usa --files o --db según el objetivo)');
    return { filasTotales, fallo };
  } finally {
    await conn.end();
  }
}

// ─── Modo API (producción, sin credenciales de BD) ───
// Repara la BD que sirve Render usando la propia API de la app: GET /elementos
// para escanear y PUT /elementos/:id para corregir. Ventaja sobre --db --sin-docker:
// no necesita credenciales y calcula cada valor contra el dato VIVO del remoto,
// así que preserva ediciones manuales que el dump no refleja.
async function repararAPI(escribir) {
  // Misma convención que la app: EXPO_PUBLIC_API_URL termina en /api. Si alguien
  // pasa el origen pelado, se lo agregamos aquí (los routes del server viven bajo /api).
  let base = (process.env.EXPO_PUBLIC_API_URL || 'https://fablab-api-sr1q.onrender.com/api').replace(/\/$/, '');
  if (!base.endsWith('/api')) base += '/api';
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.API_TOKEN) headers.Authorization = `Bearer ${process.env.API_TOKEN}`;

  const res = await fetch(`${base}/elementos`);
  if (!res.ok) throw new Error(`GET ${base}/elementos → ${res.status}`);
  const elems = await res.json();
  const CAMPOS = ['detalle', 'estado', 'observaciones', 'serial', 'inventario'];

  const pendientes = [];
  let fallo = false;
  for (const e of elems) {
    const body = {};
    for (const c of CAMPOS) {
      const v = e[c];
      if (typeof v !== 'string' || !SOSPECHOSOS.test(v)) continue;
      const { reparado, reemplazos, residuo } = repararTexto(v);
      if (residuo) {
        console.error(`  ⚠ id=${e.id} ${c}: 'Ã/Â' sin mapa: ${JSON.stringify(v.slice(0, 80))} — campo NO tocado`);
        fallo = true;
        continue;
      }
      if (reemplazos) body[c] = reparado;
    }
    if (Object.keys(body).length) pendientes.push({ id: e.id, codigo: e.codigo, body });
  }
  console.log(`API ${base}: ${elems.length} elementos, ${pendientes.length} con mojibake${escribir ? '' : ' (dry-run)'}`);

  if (escribir && pendientes.length) {
    let ok = 0;
    for (const p of pendientes) {
      const r = await fetch(`${base}/elementos/${p.id}`, {
        method: 'PUT', headers, body: JSON.stringify(p.body),
      });
      if (r.ok) { ok++; process.stdout.write('.'); }
      else console.error(`\n  ✗ ${p.codigo} (id ${p.id}) → ${r.status}`);
      await new Promise((pausa) => setTimeout(pausa, 120)); // no saturar el free tier
    }
    console.log(`\n  ${ok}/${pendientes.length} reparados vía PUT /elementos/:id`);
    if (ok < pendientes.length) fallo = true;
  }
  return { filasTotales: pendientes.length, fallo };
}

// ─── main ───
const args = process.argv.slice(2);
const quiereFiles = args.includes('--files');
const quiereDB = args.includes('--db');
const quiereAPI = args.includes('--api');
const check = args.includes('--check');

// Sin flags: dry-run de archivos; BD/API solo si sus flags las piden.
const escribirFiles = quiereFiles && !check;
const probarFiles = escribirFiles || check || args.length === 0;
const probarDB = quiereDB || check;
const probarAPI = quiereAPI || check;

let fallo = false;
if (probarFiles) {
  const r = repararArchivos(escribirFiles);
  fallo ||= r.fallo;
}
if (probarDB) {
  try {
    const r = await repararBD(quiereDB && !check);
    fallo ||= r.fallo;
  } catch (e) {
    console.error(`BD: no accesible (${e.message})`);
    if (check) fallo = true;
  }
}
if (probarAPI) {
  try {
    const r = await repararAPI(quiereAPI && !check);
    fallo ||= r.fallo;
  } catch (e) {
    console.error(`API: no accesible (${e.message})`);
    if (check) fallo = true;
  }
}
process.exit(fallo ? 1 : 0);
