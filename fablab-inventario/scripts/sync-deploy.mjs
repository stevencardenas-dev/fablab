#!/usr/bin/env node
// Sincroniza el monorepo → repos de deploy (Masterkillerr/fablab-api y
// Masterkillerr/fablab-web), que son los que Render y el hosting estático
// consumen. Evita el drift manual: un solo comando copia lo que toca.
//
// Uso (desde fablab-inventario/ o cualquier subcarpeta del monorepo):
//   npm run sync:deploy                  # vista previa (no sube nada)
//   npm run sync:deploy -- --push api    # prepara y hace commit+push de api
//   npm run sync:deploy -- --push web    # ídem para web
//   npm run sync:deploy -- --push api,web
//   ... añade --force-web para sincronizar web aunque el repo deploy tenga
//       commits manuales posteriores al último sync (se BORRARÍAN).
//
// Reglas de seguridad (aprendidas a la mala):
//  1. El build web SIEMPRE se hace aquí con EXPO_PUBLIC_API_URL horneada
//     (sin ella el PWA se llama a sí mismo y no carga datos).
//  2. Si el repo deploy tiene commits manuales posteriores al último
//     "Sync desde monorepo", el sync de web ABORTA: esas mejoras viven solo
//     ahí y se perderían. Pórtalas al monorepo primero.
//  3. El monorepo es la fuente de verdad: si editas algo directo en un repo
//     deploy, es un cambio temporal que el próximo sync (correcto) borra.
//
// Requiere git y acceso SSH a Masterkillerr/*.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..'); // fablab-inventario/
const CACHE = join(process.env.HOME || '.', '.cache', 'fablab-deploy');
const SYNC_PREFIX = 'Sync desde monorepo';
// URL de la API horneada en el bundle web (sin ella el PWA no sabe dónde está
// la API y el inventario queda vacío). Override: EXPO_PUBLIC_API_URL=... npm run sync:deploy
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://fablab-api-sr1q.onrender.com/api';

const TARGETS = {
  api: {
    repo: 'git@github.com:Masterkillerr/fablab-api.git',
    dir: join(CACHE, 'fablab-api'),
    // server/ e importer/ enteros + el dump real; el deploy repo tiene su
    // propio package.json (mínimo, sin deps de Expo) y su README de Render.
    copy: [
      { from: 'server', to: 'server' },
      { from: 'importer', to: 'importer' },
      { from: 'ddl-data.sql', to: 'data/ddl-data.sql' },
    ],
  },
  web: {
    repo: 'git@github.com:Masterkillerr/fablab-web.git',
    dir: join(CACHE, 'fablab-web'),
  },
};

const pushArg = process.argv.includes('--push');
const pushIdx = process.argv.indexOf('--push');
const which = pushIdx !== -1 && process.argv[pushIdx + 1]
  ? process.argv[pushIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : ['api', 'web'];
const forceWeb = process.argv.includes('--force-web');

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const shOut = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

function ensureClone(name, t) {
  if (existsSync(join(t.dir, '.git'))) {
    sh('git fetch origin && git reset --hard origin/main && git clean -fd', t.dir);
    console.log(`[${name}] repo actualizado en cache (${shOut('git rev-parse --short HEAD', t.dir)})`);
  } else {
    rmSync(t.dir, { recursive: true, force: true });
    mkdirSync(dirname(t.dir), { recursive: true });
    sh(`git clone ${t.repo} ${t.dir}`);
    console.log(`[${name}] clonado en ${t.dir}`);
  }
}

// Commits manuales (no hechos por este script) desde el último sync.
// Si existen en un repo de artefactos, un sync los BORRARÍA.
function commitsManualesDesdeUltimoSync(t) {
  const lineas = shOut('git log --format=%s origin/main', t.dir).split('\n');
  const manuales = [];
  for (const linea of lineas) {
    if (linea.startsWith(SYNC_PREFIX)) break; // todo lo anterior ya fue sincronizado
    if (linea.trim()) manuales.push(linea);
  }
  return manuales;
}

function copyInto(fromAbs, toAbs) {
  const st = statSync(fromAbs);
  if (st.isDirectory()) {
    mkdirSync(toAbs, { recursive: true });
    for (const entry of readdirSync(fromAbs)) {
      copyInto(join(fromAbs, entry), join(toAbs, entry));
    }
  } else {
    mkdirSync(dirname(toAbs), { recursive: true });
    cpSync(fromAbs, toAbs);
  }
}

function hasChanges(dir) {
  return shOut('git status --porcelain', dir).length > 0;
}

function syncApi(t) {
  for (const { from, to } of TARGETS.api.copy) {
    const src = join(APP_ROOT, from);
    if (!existsSync(src)) {
      console.error(`[api] falta ${from} en el monorepo — ¿ruta correcta?`);
      process.exit(1);
    }
    copyInto(src, join(t.dir, to));
  }
  console.log('[api] copiado: server/ + importer/ + data/ddl-data.sql');
}

function syncWeb(t) {
  // Build SIEMPRE fresco y con la API URL horneada (regla 1).
  // EXPO_PUBLIC_API_TOKEN (si está en el entorno) se hornea también: el server
  // con API_TOKEN exige 'Authorization: Bearer' en escrituras. Ojo: el bundle
  // es público, esto frena vandalismo casual, NO es seguridad real.
  //
  // --clear NO es opcional: Expo inlinea los EXPO_PUBLIC_* durante el
  // transform, y Metro reutiliza su cache aunque cambien esas variables. Sin
  // --clear, un export anterior (p. ej. de prueba, sin token) deja su bundle
  // cacheado y el deploy sube la URL/token VIEJOS sin avisar — solo se detecta
  // si cambió el host (la verificación de abajo).
  const tokenPart = process.env.EXPO_PUBLIC_API_TOKEN ? `EXPO_PUBLIC_API_TOKEN=${process.env.EXPO_PUBLIC_API_TOKEN} ` : '';
  console.log(`[web] exportando con EXPO_PUBLIC_API_URL=${API_URL}${process.env.EXPO_PUBLIC_API_TOKEN ? ' + token de escritura' : ''} ...`);
  sh(`${tokenPart}EXPO_PUBLIC_API_URL=${API_URL} npx expo export --platform web --clear`, APP_ROOT);
  const dist = join(APP_ROOT, 'dist');
  if (!existsSync(dist)) {
    console.error('[web] el export no generó dist/');
    process.exit(1);
  }
  // Verifica que la URL quedó horneada en el bundle (el bug clásico).
  let baked = false;
  const jsDir = join(dist, '_expo', 'static', 'js', 'web');
  for (const f of readdirSync(jsDir)) {
    if (readFileSyncSafe(join(jsDir, f)).includes('onrender')) { baked = true; break; }
  }
  if (!baked) {
    console.error('[web] ABORTADO: el bundle no tiene la API URL horneada (¿cambió el host?)');
    process.exit(1);
  }
  for (const entry of readdirSync(t.dir)) {
    if (entry === '.git') continue;
    rmSync(join(t.dir, entry), { recursive: true, force: true });
  }
  copyInto(dist, t.dir);
  // Fallback SPA para deep links (p.ej. /sala/CNC): el hosting sirve 404.html
  // en rutas desconocidas; debe ser una copia fresca de index.html.
  cpSync(join(t.dir, 'index.html'), join(t.dir, '404.html'));
  console.log('[web] dist/ volcado (+ 404.html regenerado desde index.html)');
}

function readFileSyncSafe(p) {
  try { return execSync(`cat "${p}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ''; }
}

function commitAndPush(name, t) {
  if (!hasChanges(t.dir)) {
    console.log(`[${name}] sin cambios que subir ✔`);
    return;
  }
  const msg = `${SYNC_PREFIX} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
  sh(`git add -A && git commit -m "${msg}" && git push origin main`, t.dir);
  console.log(`[${name}] commiteado y subido → ${TARGETS[name].repo.replace('git@github.com:', '')}`);
}

// --- main ---
mkdirSync(CACHE, { recursive: true });
for (const name of which) {
  const t = TARGETS[name];
  if (!t) {
    console.error(`Objetivo desconocido: ${name} (usa: api, web)`);
    process.exit(1);
  }
  console.log(`\n=== ${name} ===`);
  ensureClone(name, t);

  // Regla 2: abortar si hay trabajo manual posterior al último sync.
  const manuales = commitsManualesDesdeUltimoSync(t);
  if (manuales.length) {
    if (name === 'web' && !forceWeb) {
      console.error(`[web] ABORTADO — el repo deploy tiene commits manuales que este sync BORRARÍA:`);
      for (const m of manuales.slice(0, 6)) console.error(`   · ${m}`);
      console.error(`Pórtalas al monorepo primero, o fuerza con --force-web (pierdes esos cambios).`);
      process.exit(1);
    }
    console.warn(`[${name}] ⚠ ${manuales.length} commit(s) manual(es) serán sobreescritos por este sync:`);
    for (const m of manuales.slice(0, 4)) console.warn(`   · ${m}`);
  }

  if (name === 'api') syncApi(t);
  if (name === 'web') syncWeb(t);
  if (pushArg) commitAndPush(name, t);
  else {
    const status = hasChanges(t.dir) ? shOut('git status --short', t.dir) : '(sin cambios)';
    console.log(`[preview] git status en cache:\n${status}`);
  }
}

if (!pushArg) {
  console.log('\nVista previa lista. Para subir: npm run sync:deploy -- --push api[,web]');
}
