#!/usr/bin/env node
// verify-auditoria.mjs — prueba la bitácora contra MySQL local (13306, base `fablab`).
// Levanta el server en un puerto libre, hace alta → edición → traslado → baja sobre un
// elemento temporal y lee `auditoria` directo de la base: cada escritura deja UNA fila
// correcta y las que fallan (404, código duplicado) no dejan ninguna.
//   node scripts/verify-auditoria.mjs

import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
import { conexionDesdeEnv } from '../importer/importar.mjs';

const PORT = 3907;
const TOKEN = 'verify-auditoria';
const BASE = `http://127.0.0.1:${PORT}/api`;
const CODIGO = `AUD-${Date.now().toString(36).toUpperCase()}`.slice(0, 20);

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), API_TOKEN: TOKEN },
  stdio: 'ignore',
});
const db = await mysql.createConnection(conexionDesdeEnv());
let fallos = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok   ' : 'FALLA'} ${msg}`); if (!cond) fallos++; };
const pedir = (metodo, ruta, cuerpo) => fetch(`${BASE}${ruta}`, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
});
const filas = async (id) => (await db.query('SELECT accion, antes, despues FROM auditoria WHERE entidad_id = ? ORDER BY id', [id]))[0];

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const salas = await (await fetch(`${BASE}/salas`)).json();
  const [a, b] = salas;

  const alta = await (await pedir('POST', '/elementos', { sala_id: a.id, codigo: CODIGO, detalle: 'prueba auditoría', cantidad: '1' })).json();
  const id = alta.id;
  let r = await filas(id);
  ok(r.length === 1 && r[0].accion === 'alta' && r[0].despues.detalle === 'prueba auditoría', 'alta deja 1 fila con los valores');

  const dup = await pedir('POST', '/elementos', { sala_id: a.id, codigo: CODIGO, detalle: 'duplicado' });
  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM auditoria WHERE codigo = ? AND accion = 'alta'", [CODIGO]);
  ok(dup.status === 409 && Number(n) === 1, 'alta con código duplicado (409) no deja fila');

  await pedir('PUT', `/elementos/${id}`, { detalle: 'editado', cantidad: '1' });
  r = await filas(id);
  ok(r.length === 2 && r[1].accion === 'edicion' && r[1].antes.detalle === 'prueba auditoría' && r[1].despues.detalle === 'editado'
    && !('cantidad' in r[1].despues), 'edición guarda antes/después solo de lo que cambió');

  await pedir('PUT', `/elementos/${id}`, { detalle: 'editado' });
  ok((await filas(id)).length === 2, 'edición sin cambios reales no deja fila');

  const sinEl = await pedir('PUT', '/elementos/999999', { detalle: 'x' });
  const [[{ m }]] = await db.query('SELECT COUNT(*) m FROM auditoria WHERE entidad_id = 999999');
  ok(sinEl.status === 404 && Number(m) === 0, 'edición de elemento inexistente (404) no deja fila');

  await pedir('POST', '/traslados', { elementoId: id, salaNuevaId: b.id });
  r = await filas(id);
  ok(r.length === 3 && r[2].accion === 'traslado' && r[2].antes.sala_id === a.id && r[2].despues.sala_id === b.id, 'traslado guarda sala anterior y nueva');

  await pedir('DELETE', `/elementos/${CODIGO}`);
  r = await filas(id);
  ok(r.length === 4 && r[3].accion === 'baja' && r[3].antes.codigo === CODIGO, 'baja guarda la fila completa (y sobrevive al borrado)');
} finally {
  await db.end();
  server.kill();
}
console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo ok');
process.exit(fallos ? 1 : 0);
