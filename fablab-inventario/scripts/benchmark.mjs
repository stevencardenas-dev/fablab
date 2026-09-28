#!/usr/bin/env node
// Benchmark de TODAS las operaciones de la API. Cada op: 1 hit de calentamiento
// + N muestras → min/p50/max, y el delta contra el piso de red medido con
// /health (que no toca la BD): eso es lo que la app realmente añade.
//
//   node scripts/benchmark.mjs                        # producción
//   node scripts/benchmark.mjs --base http://127.0.0.1:3101/api
//
// Las escrituras corren sobre un elemento temporal QA-BENCH-* que se borra al
// final (igual que qa-intensivo: token de API_TOKEN o ~/.config/fablab/api-token).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = (baseIdx !== -1 && args[baseIdx + 1]) || 'https://fablab-api-sr1q.onrender.com/api';
const RAIZ = BASE.replace(/\/api\/?$/, '');
const N = Number(args[args.indexOf('--n') + 1]) || 8; // muestras por operación
const CODIGO = 'QA-BENCH-PERF';

function leerToken() {
  if (process.env.API_TOKEN) return process.env.API_TOKEN.trim();
  try {
    return readFileSync(join(homedir(), '.config', 'fablab', 'api-token'), 'utf8').trim();
  } catch {
    return '';
  }
}
const AUTH = (() => {
  const t = leerToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
})();

const RETRY = new Set([502, 503, 504]);
async function pedir(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  let res = await fetch(url, opts);
  for (const ms of [1000, 2500]) {
    if (!RETRY.has(res.status)) break;
    await new Promise((r) => setTimeout(r, ms));
    res = await fetch(url, opts);
  }
  return res;
}
const STATUS_OK = new Set([200, 201, 204, 304, 409, 404]); // 201 creación, 409/404 resultados esperados de ops de borde
async function medir(path, opts = {}) {
  const t0 = performance.now();
  const res = await pedir(path, opts);
  await res.arrayBuffer();
  if (!STATUS_OK.has(res.status)) throw new Error(`${path} → ${res.status}`);
  return performance.now() - t0;
}
function resumen(muestras) {
  const s = [...muestras].sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length / 2)];
  return { min: s[0], p50, max: s[s.length - 1] };
}
const f = (x) => `${Math.round(x)}ms`.padStart(7);

const filas = [];
let piso = { min: 0, p50: 0, max: 0 };

async function op(nombre, path, opts = {}, muestras = N) {
  await medir(path, opts).catch(() => {}); // calentamiento (despierta pool/cache)
  const tiempos = [];
  for (let i = 0; i < muestras; i++) tiempos.push(await medir(path, opts));
  const r = resumen(tiempos);
  filas.push({ nombre, ...r });
  console.log(`${nombre.padEnd(46)} min${f(r.min)} p50${f(r.p50)} max${f(r.max)}`);
}

(async () => {
  console.log(`Benchmark → ${BASE}  (${N} muestras/op)\n`);

  // Piso de red: /health no toca la BD (ping al proceso Render + ida y vuelta).
  console.log('piso de red (/health)'.padEnd(46), '…');
  await medir(`${RAIZ}/health`).catch(() => {});
  const h = [];
  for (let i = 0; i < N; i++) h.push(await medir(`${RAIZ}/health`));
  piso = resumen(h);
  console.log('piso de red (/health)'.padEnd(46), `min${f(piso.min)} p50${f(piso.p50)} max${f(piso.max)}\n`);

  console.log('— Lecturas —');
  await op('GET /salas', '/salas');
  await op('GET /elementos (listado 917, cache 60s)', '/elementos');
  await op('GET /salas/7/elementos (sala CNC, 171)', '/salas/7/elementos');
  await op('GET /elementos/:id/historial', '/elementos/30/historial');

  // Preparación: el elemento temporal existe ANTES de medir y lleva una foto.
  // Las lecturas de foto apuntaban al elemento 1, que tenía foto solo durante la
  // prueba de demo: con la base sin fotos, esos "GET foto" medían en realidad la
  // consulta + 404, y el +0/+69 que salía no significaba lo mismo. Ahora el
  // benchmark se autoabastece y los números se pueden comparar entre corridas.
  console.log('\n— Preparación (elemento temporal con foto) —');
  await pedir(`/elementos/${CODIGO}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
  const rAlta = await pedir('/elementos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ sala_id: 7, codigo: CODIGO, detalle: 'benchmark perf' }),
  });
  if (rAlta.status !== 201) throw new Error(`no pude crear el elemento de benchmark (${rAlta.status})`);
  const { id } = await rAlta.json();

  const fotoWebp = readFileSync(new URL('./demo-foto/foto.webp', import.meta.url));
  const miniWebp = readFileSync(new URL('./demo-foto/mini-reemplazo.webp', import.meta.url));
  const b64 = (b) => b.toString('base64');
  const payloadFoto = () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ mime: 'image/webp', foto: b64(fotoWebp), miniatura: b64(miniWebp), ancho: 800, alto: 800 }),
  });
  const rPrevia = await pedir(`/elementos/${id}/foto`, payloadFoto());
  if (rPrevia.status !== 201) throw new Error(`no pude subir la foto de benchmark (${rPrevia.status})`);
  console.log(`  elemento ${id} creado y con foto ✔`);

  console.log('\n— Fotos (miniatura y 304 desde RAM; foto grande en LRU) —');
  await op('GET foto miniatura', `/elementos/${id}/foto?tam=miniatura`);
  await op('GET foto grande 800px (LRU)', `/elementos/${id}/foto`);
  const etag = (await pedir(`/elementos/${id}/foto`)).headers.get('etag');
  await op('GET 304 revalidación (hash en RAM)', `/elementos/${id}/foto`, { headers: { 'If-None-Match': etag } });
  await op('HEAD foto (hash en RAM)', `/elementos/${id}/foto`, { method: 'HEAD' });

  console.log('\n— Escrituras (sobre el elemento temporal) —');
  await op('PUT editar elemento', `/elementos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ observaciones: `bench ${Date.now() % 1000}` }),
  });
  await op('POST duplicado rechazado (409, índice)', '/elementos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ sala_id: 7, codigo: CODIGO }),
  });
  await op('POST traslado 7→1', '/traslados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ elementoId: id, salaNuevaId: 1, nota: 'bench' }),
  }, 4);
  await op('POST traslado 1→7 (volver)', '/traslados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ elementoId: id, salaNuevaId: 7, nota: 'bench' }),
  }, 4);

  await op('POST foto 25.6KB (INSERT/UPDATE)', `/elementos/${id}/foto`, payloadFoto(), 4);
  await op('DELETE foto', `/elementos/${id}/foto`, { method: 'DELETE', headers: AUTH }, 4);

  // Alta real (el camino que usa el usuario al agregar un elemento): mide el
  // lock de código + INSERT. Se crean 3 y se borran al final, sin medir.
  console.log('\n— Alta con código nuevo (lock + INSERT) —');
  const altas = [`${CODIGO}-A1`, `${CODIGO}-A2`, `${CODIGO}-A3`];
  for (const cod of altas) await pedir(`/elementos/${cod}`, { method: 'DELETE', headers: AUTH }).catch(() => {});
  const tAltas = [];
  for (const cod of altas) {
    const t0 = performance.now();
    const r = await pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ sala_id: 7, codigo: cod, detalle: 'bench alta' }),
    });
    await r.arrayBuffer();
    if (r.status !== 201) throw new Error(`alta ${cod} → ${r.status}`);
    tAltas.push(performance.now() - t0);
  }
  const rAltas = resumen(tAltas);
  filas.push({ nombre: 'POST alta con código nuevo', ...rAltas });
  console.log(`POST alta con código nuevo`.padEnd(46) + ` min${f(rAltas.min)} p50${f(rAltas.p50)} max${f(rAltas.max)}`);
  for (const cod of altas) await pedir(`/elementos/${cod}`, { method: 'DELETE', headers: AUTH }).catch(() => {});

  console.log('\n— Export —');
  await op('GET /export/elementos.csv (917 filas)', '/export/elementos.csv');
  await op('GET /export/elementos.json', '/export/elementos.json');
  await op('GET /export/traslados.csv', '/export/traslados.csv');

  console.log('\n— Borrado (limpieza) —');
  await op('DELETE elemento con historial (transaccional)', `/elementos/${CODIGO}`, { method: 'DELETE', headers: AUTH }, 3);

  const dPiso = (x) => Math.round(x - piso.p50);
  console.log('\n≈ delta p50 contra el piso de red (lo que añade cada op) ≈');
  for (const r of filas) console.log(`${r.nombre.padEnd(46)} +${String(dPiso(r.p50)).padStart(5)}ms`);
  console.log(`\npiso de red p50: ${Math.round(piso.p50)}ms (Render free: ~200ms es despertar CPU + red)`);
})();
