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

  console.log('\n— Fotos (miniatura en RAM desde el arranque) —');
  await op('GET foto miniatura', '/elementos/1/foto?tam=miniatura');
  await op('GET foto grande 800px (LRU)', '/elementos/1/foto');
  const etag = (await pedir('/elementos/1/foto')).headers.get('etag');
  await op('GET 304 revalidación (hash en RAM)', '/elementos/1/foto', { headers: { 'If-None-Match': etag } });
  await op('HEAD foto (hash en RAM)', '/elementos/1/foto', { method: 'HEAD' });

  console.log('\n— Escrituras (elemento temporal QA-BENCH) —');
  const rAlta = await pedir('/elementos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ sala_id: 7, codigo: CODIGO, detalle: 'benchmark perf' }),
  });
  if (rAlta.status !== 201) {
    // Si quedó de otra corrida, borrar y reintentar una vez.
    await pedir(`/elementos/${CODIGO}`, { method: 'DELETE', headers: AUTH });
    const r2 = await pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ sala_id: 7, codigo: CODIGO, detalle: 'benchmark perf' }),
    });
    if (r2.status !== 201) throw new Error(`no pude crear el elemento de benchmark (${r2.status})`);
  }
  const { id } = await (await pedir('/elementos', {})).json().then((j) => j.find((e) => e.codigo === CODIGO));

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

  const fotoWebp = readFileSync(new URL('./demo-foto/foto.webp', import.meta.url));
  const miniWebp = readFileSync(new URL('./demo-foto/mini-reemplazo.webp', import.meta.url));
  const b64 = (b) => b.toString('base64');
  const payloadFoto = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ mime: 'image/webp', foto: b64(fotoWebp), miniatura: b64(miniWebp), ancho: 800, alto: 800 }),
  };
  await op('POST foto 25.6KB (INSERT/UPDATE)', `/elementos/${id}/foto`, payloadFoto, 4);
  await op('DELETE foto', `/elementos/${id}/foto`, { method: 'DELETE', headers: AUTH }, 4);

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
