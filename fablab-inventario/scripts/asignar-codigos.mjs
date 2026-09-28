#!/usr/bin/env node
// asignar-codigos.mjs — Rellena el `codigo` de los elementos que quedaron sin él.
//
// Por qué: la hoja de cálculo trae filas sin N° de inventario (hoy 35 materiales
// de CNC), y sin código el elemento no tiene Data Matrix que imprimir ni forma
// de escanearse. El código nuevo CONTINÚA la numeración que ya usa la sala
// (CNC-01…CNC-136 → CNC-137, …) en vez de inventar una familia nueva: el
// personal sigue reconociendo el código de cada sala, y la etiqueta impresa
// coincide con el N° que ya está en el Excel.
//
// Solo rellena vacíos. El server (POST /elementos/:id/codigo) rechaza con 409
// sobrescribir un código existente: ese es el identificador ya impreso en la
// etiqueta, cambiarlo invalida las etiquetas pegadas y la búsqueda por código.
//
// Uso:
//   node scripts/asignar-codigos.mjs                    # dry-run contra la BD local (Docker, 13306)
//   node scripts/asignar-codigos.mjs --api              # dry-run contra producción (GET público)
//   node scripts/asignar-codigos.mjs --api --escribir   # asigna en producción vía API (requiere API_TOKEN)
//   node scripts/asignar-codigos.mjs --db --escribir    # asigna directo en la BD local
//   node scripts/asignar-codigos.mjs --sql              # imprime los UPDATE para correrlos a mano (Aiven)
//
// Antes de escribir en producción: npm run backup:remoto.

import { conexionDesdeEnv } from '../importer/importar.mjs';

const API_URL = process.env.API_URL || 'https://fablab-api-sr1q.onrender.com/api';
const args = process.argv.slice(2);
const usarApi = args.includes('--api');
const escribir = args.includes('--escribir');
const soloSql = args.includes('--sql');

// --- Códigos nuevos ---

// Prefijo que domina en la sala: de "CNC-137" sale el prefijo "CNC". Se toma el
// más frecuente para no depender de una fila rara (p.ej. "VL-303-05" usa el
// prefijo "VL-303", que es exactamente el que el FabLab ve en esa sala).
function prefijoDominante(codigos) {
  const cuenta = new Map();
  for (const codigo of codigos) {
    const m = /^(.+)-(\d+)$/.exec(String(codigo || '').trim());
    if (!m) continue;
    cuenta.set(m[1], (cuenta.get(m[1]) || 0) + 1);
  }
  if (!cuenta.size) return null;
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function maxNumero(codigos, prefijo) {
  let max = 0;
  for (const codigo of codigos) {
    const m = /^(.+)-(\d+)$/.exec(String(codigo || '').trim());
    if (m && m[1] === prefijo) max = Math.max(max, Number(m[2]));
  }
  return max;
}

// Prefijo de respaldo si la sala no tiene ningún código con numeración.
function prefijoDeSala(nombre) {
  return String(nombre || 'ELEMENTO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ELEMENTO';
}

/**
 * Arma la lista de asignaciones {id, codigo, ...} para los elementos sin código.
 * `sinCodigo` y `todos` son filas con {id, codigo, sala_id, sala}.
 */
function planAsignaciones(sinCodigo, todos, salas) {
  const usados = new Set(todos.map((e) => String(e.codigo || '').trim()).filter(Boolean));
  const porSala = new Map();
  for (const elemento of todos) {
    if (!porSala.has(elemento.sala_id)) porSala.set(elemento.sala_id, []);
    porSala.get(elemento.sala_id).push(elemento.codigo);
  }

  const siguiente = new Map(); // sala_id -> próximo número a usar
  const plan = [];
  for (const elemento of sinCodigo) {
    let proximo = siguiente.get(elemento.sala_id);
    if (proximo == null) {
      const nombreSala = salas.find((s) => s.id === elemento.sala_id)?.nombre;
      const prefijo = prefijoDominante(porSala.get(elemento.sala_id) || []) || prefijoDeSala(nombreSala);
      const ancho = prefijo === prefijoDeSala(nombreSala) ? 0 : 2; // CNC-01 / SALA-PRUEBA-1
      proximo = { prefijo, numero: maxNumero(porSala.get(elemento.sala_id) || [], prefijo) + 1, ancho };
    }
    let codigo;
    do {
      codigo = `${proximo.prefijo}-${String(proximo.numero).padStart(proximo.ancho, '0')}`;
      proximo.numero++;
    } while (usados.has(codigo));
    usados.add(codigo);
    siguiente.set(elemento.sala_id, proximo);
    plan.push({ id: elemento.id, codigo, detalle: elemento.detalle, sala: elemento.sala });
  }
  return plan;
}

// --- Lectura del estado actual ---

async function leerPorApi() {
  const traer = async (ruta) => {
    const res = await fetch(`${API_URL}${ruta}`);
    if (!res.ok) throw new Error(`GET ${ruta} → ${res.status}`);
    return res.json();
  };
  const [elementos, salas] = await Promise.all([traer('/elementos'), traer('/salas')]);
  return {
    salas,
    todos: elementos.map((e) => ({
      ...e,
      sala: salas.find((s) => s.id === e.sala_id)?.nombre ?? `sala ${e.sala_id}`,
    })),
  };
}

async function leerPorBD() {
  const cfg = conexionDesdeEnv();
  const { listarElementosTotales, listarSalas, cerrarPools } = await import('../importer/api.mjs');
  const [elementos, salas] = await Promise.all([listarElementosTotales(cfg), listarSalas(cfg)]);
  return {
    salas,
    todos: elementos.map((e) => ({
      ...e,
      sala: salas.find((s) => s.id === e.sala_id)?.nombre ?? `sala ${e.sala_id}`,
    })),
    cerrar: cerrarPools,
  };
}

// --- Escritura ---

async function escribirPorApi(plan, token) {
  if (!token) {
    console.error('Falta API_TOKEN (el server exige Authorization: Bearer en escrituras).');
    console.error('  API_TOKEN=$(cat ~/.config/fablab/api-token) node scripts/asignar-codigos.mjs --api --escribir');
    process.exit(1);
  }
  let ok = 0;
  for (const { id, codigo } of plan) {
    const res = await fetch(`${API_URL}/elementos/${id}/codigo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ codigo }),
    });
    if (res.status === 404) {
      console.error(`\nLa api desplegada no tiene POST /elementos/:id/codigo todavía.`);
      console.error('Sube la api primero:  npm run sync:deploy -- --push api');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`  ✗ id ${id}: ${res.status} ${(await res.json().catch(() => ({}))).error ?? ''}`);
      continue;
    }
    ok++;
  }
  return ok;
}

async function escribirPorBD(plan) {
  const cfg = conexionDesdeEnv();
  const { asignarCodigo, cerrarPools } = await import('../importer/api.mjs');
  let ok = 0;
  for (const { id, codigo } of plan) {
    try {
      await asignarCodigo(id, codigo, cfg);
      ok++;
    } catch (e) {
      console.error(`  ✗ id ${id}: ${e.message}`);
    }
  }
  await cerrarPools();
  return ok;
}

// --- main ---

const { salas, todos, cerrar } = usarApi ? await leerPorApi() : await leerPorBD();
const sinCodigo = todos.filter((e) => !String(e.codigo || '').trim());
const plan = planAsignaciones(sinCodigo, todos, salas);
await cerrar?.();

console.log(`fuente: ${usarApi ? `API ${API_URL}` : 'BD (MYSQL_HOST/MYSQL_PORT)'}`);
console.log(`elementos: ${todos.length} · sin código: ${sinCodigo.length}\n`);

if (!plan.length) {
  console.log('No hay nada que asignar: todos los elementos tienen código ✔');
  process.exit(0);
}

for (const { id, codigo, detalle, sala } of plan) {
  console.log(`  ${String(id).padStart(5)}  ${codigo.padEnd(14)} ${sala.padEnd(10)} ${detalle ?? ''}`);
}
const porSala = plan.reduce((a, p) => ((a[p.sala] = (a[p.sala] || 0) + 1), a), {});
console.log(`\n${plan.length} código(s): ${Object.entries(porSala).map(([s, n]) => `${s} +${n}`).join(', ')}`);

if (soloSql) {
  console.log('\n-- UPDATEs para correr a mano (solo rellenan NULL; un código existente no se toca):');
  for (const { id, codigo } of plan) {
    console.log(`UPDATE elementos SET codigo = '${codigo}' WHERE id = ${id} AND (codigo IS NULL OR codigo = '');`);
  }
  process.exit(0);
}

if (!escribir) {
  console.log('\nDry-run: no se escribió nada. Para aplicar:  --escribir  (y --api para producción)');
  console.log('Backup antes de tocar producción:  npm run backup:remoto');
  process.exit(0);
}

const aplicados = usarApi ? await escribirPorApi(plan, process.env.API_TOKEN) : await escribirPorBD(plan);
console.log(`\n${aplicados}/${plan.length} código(s) asignado(s).`);
process.exit(aplicados === plan.length ? 0 : 1);
