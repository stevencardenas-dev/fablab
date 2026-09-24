#!/usr/bin/env node
// backup-remoto.mjs — Snapshot de la BD de producción vía la API pública.
//
// Esta sesión reparamos 24 filas en producción ANTES de sacar backup: quedó
// bien porque el plan se verificó en dry-run, pero fue suerte y no método.
// Los endpoints /api/export/{elementos,traslados}.json ya existen — esto los
// usa para dejar un snapshot versionado por fecha, ANTES de tocar nada.
//
// Uso:
//   node scripts/backup-remoto.mjs                    # snapshot en backups/
//   EXPO_PUBLIC_API_URL=... node scripts/backup-remoto.mjs
//   API_TOKEN=... node scripts/backup-remoto.mjs      # si el server exige auth
//   node scripts/backup-remoto.mjs --stdout elementos # imprimir a stdout sin escribir
//
// El JSON crudo de la API preserva los campos exactamente como la app los ve;
// para restaurar hay que re-insertar con el mismo esquema (o regenerar el dump
// con mysqldump cuando se tengan credenciales de BD).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

// Misma convención que la app: EXPO_PUBLIC_API_URL termina en /api (si pasan el
// origen pelado, se agrega aquí — los routes del server viven bajo /api).
let base = (process.env.EXPO_PUBLIC_API_URL || 'https://fablab-api-sr1q.onrender.com/api').replace(/\/$/, '');
if (!base.endsWith('/api')) base += '/api';
const headers = {};
if (process.env.API_TOKEN) headers.Authorization = `Bearer ${process.env.API_TOKEN}`;

async function descargar(ruta) {
  const res = await fetch(`${base}${ruta}`, { headers });
  if (!res.ok) throw new Error(`GET ${ruta} → ${res.status}`);
  return res.json();
}

function filas(json) {
  if (Array.isArray(json)) return json.length;
  throw new Error('formato inesperado (se esperaba un array)');
}

async function main() {
  const solo = args.includes('--stdout') ? args[args.indexOf('--stdout') + 1] : null;
  const exportables = ['elementos', 'traslados'];

  if (solo) {
    if (!exportables.includes(solo)) {
      console.error(`--stdout espera: ${exportables.join('|')}`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(await descargar(`/export/${solo}.json`), null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const dir = path.join(raiz, 'backups');
  mkdirSync(dir, { recursive: true });

  for (const nombre of exportables) {
    const data = await descargar(`/export/${nombre}.json`);
    const archivo = path.join(dir, `${nombre}-${stamp}.json`);
    writeFileSync(archivo, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`${archivo}  (${filas(data)} filas)`);
  }
  console.log('Snapshot completo. Antes de operar la BD en producción, corre esto primero.');
}

main().catch((e) => {
  console.error(`backup falló: ${e.message}`);
  process.exit(1);
});
