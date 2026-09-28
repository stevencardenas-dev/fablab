#!/usr/bin/env node
// fotos-demo.mjs — Pone LA MISMA foto en todos los elementos, para ver en la app
// desplegada cómo se ve el inventario con fotos en todas partes y cuánto pesa
// realmente (una petición de miniatura por elemento pintado, contra la API de
// producción y contra MySQL en Aiven).
//
// Es una prueba en vivo, así que está hecha para poder DESHACERSE:
//   · Sólo toca elementos que NO tienen foto (hoy: los 917). Un elemento con
//     foto se saltea: el binario viejo no lo tenemos, pisarlo no se puede
//     deshacer — para eso hay que pedirlo explícito con --sobrescribir.
//   · Antes de escribir deja un manifiesto en backups/ con los ids exactos que
//     va a tocar. `--revertir` borra esos ids y nada más.
//   · El estado final esperado después de revertir es el de hoy: 0 fotos.
//
// Uso:
//   node scripts/fotos-demo.mjs                       # estado actual (GET público, no escribe)
//   node scripts/fotos-demo.mjs --medir               # latencia real de miniatura/foto en producción
//   node scripts/fotos-demo.mjs --escribir            # rellena los elementos sin foto
//   node scripts/fotos-demo.mjs --escribir --limite 5 # prueba corta (5 elementos)
//   node scripts/fotos-demo.mjs --revertir            # deshace (último manifiesto)
//   node scripts/fotos-demo.mjs --revertir backups/fotos-demo-2026-09-23-23-10.json
//
//   API_URL=... node scripts/fotos-demo.mjs --escribir   # contra el server local
//
// El token de escritura sale de API_TOKEN, o de ~/.config/fablab/api-token
// (mismo sitio que usan fix:mojibake y backup:remoto). Antes de tocar
// producción:  npm run backup:remoto

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DIR = path.join(RAIZ, 'scripts', 'demo-foto');

// Los dos tamaños salen del mismo PNG de origen con cwebp:
//   cwebp -q 82 -resize 800 800 origen.png -o foto.webp        (800×800, ~26 KB)
//   cwebp -q 95 -resize 200 200 origen.png -o miniatura.webp   (200×200, ~5 KB)
// Las calidades se eligieron para caer en el MISMO peso que una foto de cámara
// ya optimizada por la app (800 px q0.6 ≈ 26 KB + miniatura ≈ 6 KB = ~31 KB):
// con una imagen más liviana la medición de carga saldría mejor que la realidad.
const MIME = 'image/webp';
const LADO_FOTO = 800;
const LADO_MINIATURA = 200;

const args = process.argv.slice(2);
const valorDe = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const escribir = args.includes('--escribir');
const revertir = args.includes('--revertir');
const sobrescribir = args.includes('--sobrescribir');
const medir = args.includes('--medir');
const limite = valorDe('--limite') ? Number(valorDe('--limite')) : null;
const paralelo = Math.max(1, valorDe('--paralelo') ? Number(valorDe('--paralelo')) : 3);

let API_URL = process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || 'https://fablab-api-sr1q.onrender.com/api';
API_URL = API_URL.replace(/\/$/, '');
if (!API_URL.endsWith('/api')) API_URL += '/api';

// Token: env primero (como los otros scripts), si no el archivo local. No se
// imprime nunca; lo único que se dice es de dónde salió.
const TOKEN_FILE = path.join(process.env.HOME || '', '.config', 'fablab', 'api-token');
function tokenEscritura() {
  if (process.env.API_TOKEN) return { token: process.env.API_TOKEN, origen: 'API_TOKEN' };
  try {
    return { token: readFileSync(TOKEN_FILE, 'utf8').trim(), origen: TOKEN_FILE.replace(process.env.HOME || '', '~') };
  } catch {
    return { token: '', origen: null };
  }
}

const ms = (n) => `${Math.round(n)} ms`;
const peso = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// --- HTTP ---

const REINTENTABLES = new Set([502, 503, 504]); // cold start del free tier

async function pedir(url, opciones = {}, esperas = [1500, 4000]) {
  let res = await fetch(url, opciones);
  for (const espera of esperas) {
    if (!REINTENTABLES.has(res.status)) return res;
    await new Promise((r) => setTimeout(r, espera));
    res = await fetch(url, opciones);
  }
  return res;
}

async function elementos() {
  const res = await pedir(`${API_URL}/elementos`);
  if (!res.ok) throw new Error(`GET /elementos → ${res.status}`);
  return res.json();
}

function cabecerasAuth(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// --- Imágenes de la prueba ---

function leerDemo() {
  const foto = readFileSync(path.join(DEMO_DIR, 'foto.webp'));
  const miniatura = readFileSync(path.join(DEMO_DIR, 'miniatura.webp'));
  if (!foto.length || !miniatura.length) throw new Error('scripts/demo-foto/*.webp vacíos');
  if (miniatura.length >= foto.length) {
    throw new Error('la miniatura pesa más que la foto: el server la rechaza (400)');
  }
  return { foto, miniatura };
}

function payloadDemo({ foto, miniatura }) {
  return JSON.stringify({
    mime: MIME,
    foto: foto.toString('base64'),
    miniatura: miniatura.toString('base64'),
    ancho: LADO_FOTO,
    alto: LADO_FOTO,
  });
}

// --- Manifiesto (lo que hace reversible la prueba) ---

function carpetaBackups() {
  const dir = path.join(RAIZ, 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sello() {
  // Con segundos: dos corridas en el mismo minuto no se pisan el manifiesto.
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

function guardarManifiesto(datos, destino) {
  const archivo = destino ?? path.join(carpetaBackups(), `fotos-demo-${sello()}.json`);
  writeFileSync(archivo, JSON.stringify(datos, null, 2) + '\n', 'utf8');
  return archivo;
}

function ultimoManifiesto() {
  const dir = carpetaBackups();
  const candidatos = readdirSync(dir)
    .filter((f) => /^fotos-demo-.*\.json$/.test(f))
    .sort();
  if (!candidatos.length) return null;
  return path.join(dir, candidatos[candidatos.length - 1]);
}

// --- Modos ---

async function estado() {
  const lista = await elementos();
  const conFoto = lista.filter((e) => e.foto_hash);
  const { foto, miniatura } = leerDemo();
  const porElemento = foto.length + miniatura.length;
  const faltan = lista.length - conFoto.length;
  console.log(`fuente:       ${API_URL}`);
  console.log(`elementos:    ${lista.length}`);
  console.log(`con foto:     ${conFoto.length}`);
  console.log(`sin foto:     ${faltan}`);
  console.log(`si se rellenan los que no tienen: ~${peso(faltan * porElemento)} en total ` +
    `(${peso(foto.length)} + ${peso(miniatura.length)} = ${peso(porElemento)} por elemento)`);
  return lista;
}

async function rellenar() {
  const { token, origen } = tokenEscritura();
  if (!token) {
    console.error('Falta el token de escritura. Define API_TOKEN o guarda ~/.config/fablab/api-token.');
    process.exit(1);
  }
  console.log(`token:        ${origen}`);
  console.log(`api:          ${API_URL}`);

  const lista = await elementos();
  const demo = leerDemo();
  const cuerpo = payloadDemo(demo);
  const pendientes = lista.filter((e) => sobrescribir || !e.foto_hash);
  const salteados = lista.filter((e) => !sobrescribir && e.foto_hash).map((e) => ({ id: e.id, codigo: e.codigo }));
  const plan = (limite ? pendientes.slice(0, limite) : pendientes).map((e) => ({
    id: e.id,
    codigo: e.codigo,
    habiaFoto: Boolean(e.foto_hash),
    hash: null,
  }));

  console.log(`elementos:    ${lista.length} · a rellenar: ${plan.length} · salteados (ya tenían foto): ${salteados.length}`);
  if (plan.some((p) => p.habiaFoto)) {
    console.log('⚠ --sobrescribir: los elementos que ya tenían foto NO se pueden restaurar (no se guardó el binario viejo).');
  }
  console.log(`peso a subir: ~${peso(plan.length * (demo.foto.length + demo.miniatura.length))}`);

  if (!plan.length) {
    console.log('\nNo hay nada que rellenar ✔');
    return;
  }

  // El manifiesto se escribe ANTES de subir: si el proceso muere a mitad, el
  // plan completo sigue en disco y --revertir sabe exactamente qué borrar.
  // `plan` va por referencia: el re-guardado del final ya lleva los hash.
  const cabecera = {
    creado: new Date().toISOString(),
    api: API_URL,
    demo: { foto_bytes: demo.foto.length, miniatura_bytes: demo.miniatura.length, mime: MIME },
    sobrescribir,
    plan,
    // Elementos que YA tenían foto y no se tocaron: si al revertir siguen
    // teniendo foto, es lo esperado (son de antes de la prueba), no un residuo.
    salteados,
  };
  const manifiesto = guardarManifiesto(cabecera);
  console.log(`manifiesto:   ${manifiesto}`);

  let ok = 0;
  let fallos = 0;
  const t0 = Date.now();
  const cola = [...plan];
  const trabajadores = Array.from({ length: Math.min(paralelo, cola.length) }, async () => {
    for (;;) {
      const item = cola.shift();
      if (!item) return;
      const res = await pedir(`${API_URL}/elementos/${item.id}/foto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cabecerasAuth(token) },
        body: cuerpo,
      });
      if (res.ok) {
        item.hash = (await res.json()).hash ?? null;
        ok++;
      } else {
        fallos++;
        item.error = `${res.status} ${(await res.json().catch(() => ({}))).error ?? ''}`.trim();
        console.error(`  ✗ id ${item.id}: ${item.error}`);
      }
      if ((ok + fallos) % 25 === 0 || ok + fallos === plan.length) {
        const ritmo = (Date.now() - t0) / (ok + fallos);
        process.stdout.write(`\r  ${ok + fallos}/${plan.length} · ${ok} ok · ${ms(ritmo)} por elemento`);
      }
    }
  });
  await Promise.all(trabajadores);
  process.stdout.write('\n');

  guardarManifiesto(cabecera, manifiesto); // ahora con el hash de cada elemento
  const total = plan.reduce((n, p) => n + (p.hash ? demo.foto.length + demo.miniatura.length : 0), 0);
  console.log(`\n${ok}/${plan.length} foto(s) puesta(s) en ${ms(Date.now() - t0)} · ~${peso(total)} subidos`);
  if (fallos) console.log(`${fallos} fallo(s): volver a correr --escribir reintenta los que falten (los que ya tienen foto se saltean).`);
  console.log('Para deshacerlo:  node scripts/fotos-demo.mjs --revertir');
}

async function deshacer() {
  const { token, origen } = tokenEscritura();
  if (!token) {
    console.error('Falta el token de escritura. Define API_TOKEN o guarda ~/.config/fablab/api-token.');
    process.exit(1);
  }
  const archivo = valorDe('--revertir') ? valorDe('--revertir') : ultimoManifiesto();
  if (!archivo) {
    console.error('No hay ningún manifiesto en backups/ (fotos-demo-*.json). Nada que revertir.');
    process.exit(1);
  }
  const manifiesto = JSON.parse(readFileSync(archivo, 'utf8'));
  const conFotoPrevia = manifiesto.plan.filter((p) => p.habiaFoto);
  console.log(`manifiesto:   ${archivo}`);
  console.log(`token:        ${origen}`);
  console.log(`a borrar:     ${manifiesto.plan.length - conFotoPrevia.length} foto(s) puestas por la prueba`);
  if (conFotoPrevia.length) {
    console.log(`⚠ ${conFotoPrevia.length} elemento(s) ya tenían foto antes: se borra igual (quedan sin foto) — sus bytes viejos no se guardaron.`);
  }

  let ok = 0;
  let sinFoto = 0;
  for (const item of manifiesto.plan) {
    const res = await pedir(`${API_URL}/elementos/${item.id}/foto`, {
      method: 'DELETE',
      headers: cabecerasAuth(token),
    });
    if (res.ok) ok++;
    else if (res.status === 404) sinFoto++;
    else console.error(`  ✗ id ${item.id}: ${res.status} ${(await res.json().catch(() => ({}))).error ?? ''}`);
    if ((ok + sinFoto) % 50 === 0) process.stdout.write(`\r  ${ok + sinFoto}/${manifiesto.plan.length}`);
  }
  process.stdout.write('\n');

  const lista = await elementos();
  const quedan = lista.filter((e) => e.foto_hash);
  const previas = new Set((manifiesto.salteados ?? []).map((s) => s.id));
  const residuo = quedan.filter((e) => !previas.has(e.id));
  console.log(`\nborradas: ${ok} · ya no tenían: ${sinFoto}`);
  console.log(`estado final: ${lista.length} elementos · ${quedan.length} con foto · ` +
    `${previas.size} de antes de la prueba`);
  if (!residuo.length) {
    console.log('✔ Deshecho: ninguna foto de la prueba quedó guardada.');
  } else {
    console.log('⚠ Quedan fotos que no salieron de este manifiesto: revísalas antes de dar la prueba por deshecha.');
    for (const e of residuo.slice(0, 10)) console.log(`   · id ${e.id} ${e.codigo}`);
  }
}

// Latencia del camino real (la app pide una miniatura por elemento pintado:
// abrir una sala son ~30-40 peticiones casi simultáneas al free tier).
async function medirLatencia() {
  const lista = (await elementos()).filter((e) => e.foto_hash);
  if (!lista.length) {
    console.log('No hay fotos que medir todavía: corre primero --escribir.');
    return;
  }
  const muestra = lista.filter((_, i) => i % Math.max(1, Math.floor(lista.length / 24)) === 0).slice(0, 24);
  const url = (e, tam) => `${API_URL}/elementos/${e.id}/foto?tam=${tam}&v=${encodeURIComponent(e.foto_hash)}`;

  const cronometrar = async (fn) => {
    const t0 = Date.now();
    await fn();
    return Date.now() - t0;
  };
  const stats = (tiempos) => {
    const orden = [...tiempos].sort((a, b) => a - b);
    const p = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
    return `p50 ${ms(p(0.5))} · p95 ${ms(p(0.95))} · máx ${ms(orden[orden.length - 1])}`;
  };
  // La primera petición paga el arranque del servicio (cold start): se descarta
  // para no confundir "el free tier estaba dormido" con "las fotos pesan".
  await fetch(url(muestra[0], 'miniatura')).then((r) => r.arrayBuffer());

  console.log(`api: ${API_URL}\nsobre ${muestra.length} elementos con foto\n`);
  const tMini = [];
  for (const e of muestra) tMini.push(await cronometrar(() => fetch(url(e, 'miniatura')).then((r) => r.arrayBuffer())));
  console.log(`miniatura (200 px, en serie):     ${stats(tMini)}`);

  const tFoto = [];
  for (const e of muestra.slice(0, 6)) tFoto.push(await cronometrar(() => fetch(url(e, 'foto')).then((r) => r.arrayBuffer())));
  console.log(`foto (800 px, en serie):          ${stats(tFoto)}`);

  const tSala = await cronometrar(() => Promise.all(muestra.map((e) => fetch(url(e, 'miniatura')).then((r) => r.arrayBuffer()))));
  console.log(`sala completa (${muestra.length} miniaturas a la vez): ${ms(tSala)} en total`);

  const tRevalidar = await cronometrar(async () => {
    const r = await fetch(url(muestra[0], 'foto'));
    const etag = r.headers.get('etag');
    await r.arrayBuffer();
    if (!etag) return;
    await fetch(url(muestra[0], 'foto'), { headers: { 'If-None-Match': etag } }).then((x) => x.arrayBuffer());
  });
  console.log(`foto + revalidación por ETag:     ${ms(tRevalidar)}`);
  console.log('\nSi esto sale lento, el cuello no son las fotos: la primera carga incluye el cold start de Render.');
}

// --- main ---

try {
  if (revertir) await deshacer();
  else if (medir) await medirLatencia();
  else if (escribir) await rellenar();
  else await estado();
} catch (e) {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
}
