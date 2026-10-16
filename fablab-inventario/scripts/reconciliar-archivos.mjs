#!/usr/bin/env node
// reconciliar-archivos.mjs — deja la base 1:1 con un libro de inventario (la versión más nueva).
//
// Por cada sala del libro (importer/normalizado.mjs → HOJAS), la base queda con
// exactamente las filas del archivo: lo que no está en el archivo se elimina,
// lo que está y falta se agrega, y los valores se igualan al archivo. Las filas
// que son el mismo elemento con otro código se emparejan por nombre y el código
// NO cambia (es el identificador impreso; la API no lo edita): se reporta.
//
// Por defecto NO escribe: imprime el plan. Con --aplicar ejecuta.
//
// Uso:
//   node scripts/reconciliar-archivos.mjs --archivo "/ruta/INVENTARIO ESTUDIO TV.xlsx"
//   node scripts/reconciliar-archivos.mjs --archivo ... --base http://localhost:3201/api --aplicar
//
// El token (escrituras) sale de API_TOKEN o de ~/.config/fablab/api-token.
// Hacer antes `npm run backup:remoto` cuando el destino sea producción.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import XLSX from 'xlsx';

// xlsx 0.20 (build ESM) no trae acceso a disco: hay que darle `fs` para readFile.
XLSX.set_fs?.(fs); // 0.18 (npm) no la tiene y no la necesita
import { HOJAS } from '../importer/normalizado.mjs';

const args = process.argv.slice(2);
const opcion = (nombre, defecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : defecto;
};
const APLICAR = args.includes('--aplicar');
const BASE = opcion('--base', 'https://fablab-api-sr1q.onrender.com/api').replace(/\/$/, '');
const ARCHIVO = opcion('--archivo', null);
if (!ARCHIVO) {
  console.error('Falta --archivo "<ruta al .xlsx>"');
  process.exit(1);
}

const TOKEN = process.env.API_TOKEN
  || (() => { try { return readFileSync(path.join(homedir(), '.config', 'fablab', 'api-token'), 'utf8').trim(); } catch { return ''; } })();

// ---- Normalización (igual criterio que el importador) ----------------------
const limpio = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const clave = (v) => limpio(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const numClave = (c) => { const m = clave(c).match(/^([a-z0-9]+?)-?0*(\d+)$/); return m ? `${m[1]}#${m[2]}` : clave(c); };
const ALIAS = { nombre: 'detalle', nombre_tecnico: 'detalle', n_inventario: 'inventario', observacion: 'observaciones', cod_inventario: 'inventario' };
const encabezado = (h) => {
  const k = clave(h).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ALIAS[k] || k;
};
const CAMPOS_EDITABLES = ['detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'];

// Observaciones que la base no tiene campo para guardar (ubicación, nombre coloquial) van al final de observaciones
function observacionesDe(f) {
  const partes = [];
  if (f.observaciones) partes.push(f.observaciones);
  if (f.ubicacion || f.nivel) partes.push(`Ubicación ${[f.ubicacion, f.nivel].filter(Boolean).join(', nivel ')}`);
  if (f.nombre_coloquial) partes.push(`Nombre coloquial: ${f.nombre_coloquial}`);
  return partes.join(' · ') || '';
}

// ---- Lectura del libro ------------------------------------------------------
const libro = XLSX.readFile(ARCHIVO);
const hojaReal = (nombre) => libro.SheetNames.find((n) => clave(n) === clave(nombre));
const filasDelLibro = [];
for (const { nombre, sala } of HOJAS) {
  const real = hojaReal(nombre);
  if (!real) { console.log(`(el libro no tiene la hoja "${nombre.trim()}": se omite)`); continue; }
  const rows = XLSX.utils.sheet_to_json(libro.Sheets[real], { header: 1, defval: '' });
  const enc = (rows[0] || []).map(encabezado);
  const columnas = new Set(enc.filter(Boolean));
  for (const r of rows.slice(1)) {
    const f = Object.fromEntries(enc.map((h, i) => [h, limpio(r[i])]));
    if (!Object.values(f).some((v) => v !== '')) continue;
    filasDelLibro.push({
      sala, hoja: real.trim(), codigo: f.codigo || '', detalle: f.detalle || '', serial: f.serial || '',
      inventario: f.inventario || '', estado: f.estado || '', cantidad: f.cantidad || '',
      observaciones: observacionesDe(f), columnas,
    });
  }
}

// ---- Estado actual de la base ----------------------------------------------
async function leer(ruta) {
  const r = await fetch(`${BASE}${ruta}`);
  if (!r.ok) throw new Error(`GET ${ruta} → ${r.status}`);
  return r.json();
}
const salas = await leer('/salas');
const idSala = Object.fromEntries(salas.map((s) => [s.nombre, s.id]));
const nombreSala = Object.fromEntries(salas.map((s) => [s.id, s.nombre]));
const elementos = (await leer('/elementos')).map((e) => ({ ...e, sala: nombreSala[e.sala_id] || e.sala }));

// ---- Emparejamiento por identidad dentro de cada sala ----------------------
const usadosProd = new Set();
const usadosFila = new Set();
const pares = [];
function emparejar(criterio, motivo, prod = elementos, filas = filasDelLibro) {
  for (const p of prod) {
    if (usadosProd.has(p.id)) continue;
    const j = filas.findIndex((f, i) => !usadosFila.has(i) && f.sala === p.sala && criterio(p, f));
    if (j < 0) continue;
    pares.push({ p, f: filas[j], motivo });
    usadosProd.add(p.id);
    usadosFila.add(filasDelLibro.indexOf(filas[j]));
  }
}
emparejar((p, f) => p.codigo && f.codigo && clave(p.codigo) === clave(f.codigo) && clave(p.detalle) === clave(f.detalle), 'código y nombre');
emparejar((p, f) => !limpio(p.detalle) && p.codigo && f.codigo && numClave(p.codigo) === numClave(f.codigo), 'número (nombre vacío en la base)');
emparejar((p, f) => limpio(p.detalle) && clave(p.detalle) === clave(f.detalle), 'nombre (el código cambia)');
// El mismo elemento (mismo código y nombre) en otra sala del archivo: es un traslado pendiente
for (const p of elementos) {
  if (usadosProd.has(p.id) || !p.codigo) continue;
  const j = filasDelLibro.findIndex((f, i) => !usadosFila.has(i) && f.codigo && clave(f.codigo) === clave(p.codigo) && clave(f.detalle) === clave(p.detalle));
  if (j < 0) continue;
  pares.push({ p, f: filasDelLibro[j], motivo: 'traslado', traslado: { desde: p.sala, hasta: filasDelLibro[j].sala } });
  usadosProd.add(p.id);
  usadosFila.add(j);
}

const sobranProd = elementos.filter((p) => !usadosProd.has(p.id));
const sobranFila = filasDelLibro.filter((_, i) => !usadosFila.has(i));

// ---- Plan -------------------------------------------------------------------
const plan = { trasladar: [], borrar: [], actualizar: [], codigoDistinto: [], agregar: [], salaFaltante: [] };
for (const par of pares) {
  if (par.traslado) { plan.trasladar.push({ id: par.p.id, codigo: par.p.codigo, desde: par.traslado.desde, hasta: par.f.sala }); }
  if (par.p.codigo !== par.f.codigo && par.f.codigo) plan.codigoDistinto.push({ sala: par.f.sala, base: par.p.codigo, archivo: par.f.codigo, detalle: par.f.detalle });
  const cambios = {};
  const campos = [['detalle', par.f.columnas.has('detalle')], ['serial', par.f.columnas.has('serial')], ['inventario', par.f.columnas.has('inventario')],
    ['estado', par.f.columnas.has('estado')], ['observaciones', par.f.columnas.has('observaciones') || par.f.columnas.has('ubicacion') || par.f.columnas.has('nombre_coloquial')],
    ['cantidad', par.f.columnas.has('cantidad')]];
  for (const [campo, enArchivo] of campos) {
    if (!enArchivo) continue;
    const antes = limpio(par.p[campo]); const despues = campo === 'observaciones' ? par.f.observaciones : limpio(par.f[campo]);
    if (antes !== despues) cambios[campo] = despues || null;
  }
  if (Object.keys(cambios).length) plan.actualizar.push({ id: par.p.id, codigo: par.p.codigo, sala: par.f.sala, cambios });
}
for (const p of sobranProd) {
  if (plan.trasladar.some((t) => t.id === p.id)) continue;
  plan.borrar.push({ id: p.id, codigo: p.codigo, sala: p.sala, detalle: p.detalle });
}
for (const f of sobranFila) {
  if (!idSala[f.sala]) { plan.salaFaltante.push(f); continue; }
  plan.agregar.push(f);
}

// ---- Informe ----------------------------------------------------------------
const porSala = (lista) => lista.reduce((o, x) => { o[x.sala] = (o[x.sala] || 0) + 1; return o; }, {});
console.log(`\nDESTINO: ${BASE}`);
console.log(`ARCHIVO: ${path.basename(ARCHIVO)} · filas del libro: ${filasDelLibro.length} · elementos en la base: ${elementos.length}`);
console.log(`\nTrasladar (mismo elemento, otra sala en la base): ${plan.trasladar.length}  ${plan.trasladar.map((t) => `${t.codigo} ${t.desde}→${t.hasta}`).join(' | ')}`);
console.log(`Borrar (en la base, no está en el archivo): ${plan.borrar.length}  ${JSON.stringify(porSala(plan.borrar))}`);
plan.borrar.slice(0, 40).forEach((b) => console.log(`    ${b.codigo} [${b.sala}] ${b.detalle || ''}`));
console.log(`Actualizar valores: ${plan.actualizar.length} elementos`);
const porCampo = {}; plan.actualizar.forEach((a) => Object.keys(a.cambios).forEach((k) => { porCampo[k] = (porCampo[k] || 0) + 1; }));
console.log(`    por campo: ${JSON.stringify(porCampo)}`);
console.log(`Agregar (en el archivo, no está en la base): ${plan.agregar.length}  ${JSON.stringify(porSala(plan.agregar))}`);
if (plan.salaFaltante.length) console.log(`    ⚠ sin sala en la base (desplegar antes): ${plan.salaFaltante.length} ${JSON.stringify(porSala(plan.salaFaltante))}`);
console.log(`Código distinto (NO se cambia: el código está impreso; decisión pendiente): ${plan.codigoDistinto.length}`);
plan.codigoDistinto.forEach((c) => console.log(`    ${c.base} (base) ↔ ${c.archivo} (archivo) [${c.sala}] ${c.detalle}`));

if (!APLICAR) {
  console.log('\nDRY-RUN: no se escribió nada. Con --aplicar se ejecuta.');
  process.exit(0);
}

// ---- Ejecución --------------------------------------------------------------
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function escribir(metodo, ruta, cuerpo) {
  for (let intento = 1; intento <= 5; intento++) {
    try {
      const r = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      if (r.ok) return r.json().catch(() => ({}));
      // 429: el server limita escrituras por minuto; esperar lo que pide sin gastar intento
      if (r.status === 429) { await pausa((Number(r.headers.get('retry-after')) || 60) * 1000 + 500); intento--; continue; }
      if (r.status >= 500) { await pausa(2000 * intento); continue; }
      const t = await r.text();
      throw new Error(`${metodo} ${ruta} → ${r.status} ${t.slice(0, 160)}`);
    } catch (e) {
      if (e.message.startsWith(metodo)) throw e;
      await pausa(2000 * intento);
    }
  }
  throw new Error(`${metodo} ${ruta} sin respuesta tras 5 intentos`);
}

const errores = [];
const ok = { trasladar: 0, borrar: 0, actualizar: 0, agregar: 0 };
const intentar = async (tipo, fn) => { try { await fn(); ok[tipo]++; } catch (e) { errores.push(`${tipo}: ${e.message}`); } };

console.log('\n== aplicando ==');
for (const t of plan.trasladar) {
  await intentar('trasladar', () => escribir('POST', '/traslados', { elementoId: t.id, salaNuevaId: idSala[t.hasta], nota: 'Reconciliación con archivo' }));
}
for (const b of plan.borrar) {
  await intentar('borrar', () => escribir('DELETE', `/elementos/${encodeURIComponent(b.codigo)}`));
}
for (const a of plan.actualizar) {
  await intentar('actualizar', () => escribir('PUT', `/elementos/${a.id}`, a.cambios));
}
for (const f of plan.agregar) {
  await intentar('agregar', () => escribir('POST', '/elementos', {
    sala_id: idSala[f.sala], codigo: f.codigo, detalle: f.detalle || null, serial: f.serial || null,
    inventario: f.inventario || null, estado: f.estado || null, observaciones: f.observaciones || null,
    cantidad: f.cantidad || null,
  }));
}
console.log(`hecho: trasladados ${ok.trasladar}/${plan.trasladar.length} · borrados ${ok.borrar}/${plan.borrar.length} · actualizados ${ok.actualizar}/${plan.actualizar.length} · agregados ${ok.agregar}/${plan.agregar.length}`);
if (errores.length) { console.log(`errores (${errores.length}):`); errores.slice(0, 20).forEach((e) => console.log('  ' + e)); process.exitCode = 1; }
