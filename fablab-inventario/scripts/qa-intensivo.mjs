#!/usr/bin/env node
// QA intensivo contra la API (producción por defecto, o --base para apuntar a otro lado).
//
//   node scripts/qa-intensivo.mjs                          # producción
//   node scripts/qa-intensivo.mjs --base http://127.0.0.1:3101/api
//
// Qué hace:
//   A. Lecturas públicas (salas, elementos, historial, gzip, CORS) y errores de
//      cliente: ids no enteros → 400, inexistentes → 404
//   B. Fotos: contrato HTTP (ETag/304/HEAD/immutable, tamaños, errores). Si la
//      base no tiene fotos reales, esto se prueba sobre la foto temporal del QA
//      en la sección C: el QA ya no depende de que existan fotos
//   C. Escrituras sobre elementos temporales QA-INT-<sello> (alta, edición,
//      traslado, código, foto, autorización) y endurecimiento: JSON roto → 400,
//      cuerpo > 1 MB → 413, 5 altas simultáneas del mismo código → 1 sola se
//      crea (sin carrera), ids no enteros → 400. Borra todo lo que crea
//   D. Export CSV/JSON
//
// El token sale de API_TOKEN o ~/.config/fablab/api-token (igual que fotos-demo).
// Limpieza: borra todo lo que crea; si una corrida anterior quedó cortada,
// primero borra los restos QA-INT-* que encuentre.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = (baseIdx !== -1 && args[baseIdx + 1]) || 'https://fablab-api-sr1q.onrender.com/api';
// /health vive en la raíz del server, no bajo /api.
const RAIZ = BASE.replace(/\/api\/?$/, '');
const SELLO = new Date().toISOString().replace(/\D/g, '').slice(2, 14); // AAAMMDDHHMMSS
const PREFIJO = 'QA-INT-';

function leerToken() {
  if (process.env.API_TOKEN) return process.env.API_TOKEN.trim();
  try {
    return readFileSync(join(homedir(), '.config', 'fablab', 'api-token'), 'utf8').trim();
  } catch {
    return '';
  }
}
const TOKEN = leerToken();

// --- Resultados ---
let pass = 0;
let fail = 0;
const fallos = [];
const avisos = [];

function ok(nombre) {
  pass++;
  console.log(`  ✔ ${nombre}`);
}
function mal(nombre, detalle) {
  fail++;
  fallos.push(`${nombre}: ${detalle}`);
  console.log(`  ✘ ${nombre}: ${detalle}`);
}
function aviso(nombre, detalle) {
  avisos.push(`${nombre}: ${detalle}`);
  console.log(`  ⚠ ${nombre}: ${detalle}`);
}
function seccion(titulo) {
  console.log(`\n== ${titulo} ==`);
}

// --- HTTP ---
const RETRY = new Set([502, 503, 504]);

async function pedir(path, opts = {}, reintentos = [1000, 2500]) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...(opts.headers || {}) };
  let res = await fetch(url, { ...opts, headers });
  let quedan = [...reintentos];
  while (RETRY.has(res.status) && quedan.length) {
    await new Promise((r) => setTimeout(r, quedan.shift()));
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

function auth() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function cuerpo(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

async function ms(fn) {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
}

function p50(valores) {
  const s = [...valores].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

// Contrato HTTP de UNA foto concreta (ETag/304/HEAD/immutable/tamaños/firma).
// Se llama con una foto real si existe y con la foto temporal del QA siempre,
// así el contrato se cubre aunque la base no tenga ninguna foto (antes el
// script reventaba con TypeError al no encontrar `con.id`).
async function probarContratoFotos({ id, marca }) {
  const urlFotoEl = (i, tam) => `/elementos/${i}/foto${tam ? `?tam=${tam}` : ''}`;

  const rF = await pedir(urlFotoEl(id));
  const fotoBuf = Buffer.from(await rF.arrayBuffer());
  const etag = rF.headers.get('etag');
  const bien = rF.status === 200 && fotoBuf.length > 1000 && etag && (rF.headers.get('cache-control') || '').includes('immutable');
  bien
    ? ok(`${marca}: GET foto → 200, ${fotoBuf.length} B, ETag ${etag}, immutable`)
    : mal(`GET foto (${marca})`, `${rF.status} ${fotoBuf.length}B etag=${etag} cc=${rF.headers.get('cache-control')}`);
  const firmaOk = fotoBuf[0] === 0x52 && fotoBuf[8] === 0x57; // RIFF....WEBP
  firmaOk ? ok(`${marca}: los bytes empiezan con RIFF/WEBP (firma real)`) : mal(`firma (${marca})`, `primeros bytes ${[...fotoBuf.slice(0, 4)]}`);

  const t304 = [];
  for (let i = 0; i < 5; i++) {
    t304.push(await ms(async () => {
      const r = await pedir(urlFotoEl(id), { headers: { 'If-None-Match': etag } });
      if (r.status !== 304) throw new Error(`status ${r.status}`);
      await r.arrayBuffer();
    }));
  }
  ok(`${marca}: GET con If-None-Match → 304×5 (p50 ${p50(t304)} ms)`);

  const r304Mal = await pedir(urlFotoEl(id), { headers: { 'If-None-Match': '"sincoincidencia"' } });
  r304Mal.status === 200 ? ok(`${marca}: If-None-Match sin coincidencia → 200 con blob`) : mal(`304 falso (${marca})`, `${r304Mal.status}`);

  const rHead = await pedir(urlFotoEl(id), { method: 'HEAD' });
  const sinCuerpo = (await rHead.arrayBuffer()).byteLength === 0;
  rHead.status === 200 && sinCuerpo && rHead.headers.get('etag') === etag
    ? ok(`${marca}: HEAD → 200 sin cuerpo, mismo ETag`)
    : mal(`HEAD foto (${marca})`, `${rHead.status} cuerpo=${sinCuerpo} etag=${rHead.headers.get('etag')}`);

  const rMini = await pedir(urlFotoEl(id, 'miniatura'));
  const miniBuf = Buffer.from(await rMini.arrayBuffer());
  miniBuf.length > 0 && miniBuf.length < fotoBuf.length
    ? ok(`${marca}: miniatura → ${miniBuf.length} B < foto (${fotoBuf.length} B)`)
    : mal(`miniatura (${marca})`, `${miniBuf.length} B vs foto ${fotoBuf.length} B`);

  const rTamRaro = await pedir(urlFotoEl(id, 'cualquiercosa'));
  rTamRaro.status === 200 ? ok(`${marca}: ?tam=desconocido cae a la foto completa (200, documentado)`) : aviso('tam desconocido', `${rTamRaro.status}`);

  // El ETag promete ser el sha1[:16] de los bytes: verificarlo de verdad.
  const sha1 = createHash('sha1').update(fotoBuf).digest('hex').slice(0, 16);
  etag === `"${sha1}"` ? ok(`${marca}: ETag = sha1[:16] de los bytes servidos`) : mal(`ETag (${marca})`, `${etag} ≠ sha1 ${sha1}`);

  return { fotoBuf, etag };
}

// =====================================================================
(async () => {
  console.log(`QA intensivo → ${BASE}`);
  console.log(`token: ${TOKEN ? 'cargado' : 'AUSENTE (fallarán las escrituras)'}`);
  const tGlobal0 = Date.now();

  // --- A. Lecturas públicas ---
  seccion('A. Lecturas públicas');
  let salas;
  {
    const res = await pedir(`${RAIZ}/health`);
    const j = await cuerpo(res);
    res.status === 200 && j.ok === true ? ok('GET /health → 200 ok') : mal('GET /health', `${res.status} ${JSON.stringify(j)}`);

    const rSalas = await pedir('/salas');
    salas = await cuerpo(rSalas);
    const bienSalas = Array.isArray(salas) && salas.length > 0 && salas.every((s) => 'id' in s && 'nombre' in s);
    bienSalas ? ok(`GET /salas → ${salas.length} salas con id/nombre`) : mal('GET /salas', JSON.stringify(salas).slice(0, 120));

    const tListado = [];
    let elementos;
    for (let i = 0; i < 3; i++) {
      tListado.push(await ms(async () => {
        const r = await pedir('/elementos');
        elementos = await r.json();
      }));
    }
    const conHash = elementos.filter((e) => e.foto_hash).length;
    const bienElems = Array.isArray(elementos) && elementos.length > 900;
    if (bienElems && conHash === elementos.length) {
      ok(`GET /elementos → ${elementos.length} elementos, todos con foto_hash (p50 ${p50(tListado)} ms)`);
    } else if (bienElems && conHash > 0) {
      aviso('GET /elementos', `${elementos.length} elems pero solo ${conHash} con foto_hash (esperable en una base local sin fotos demo)`);
    } else if (bienElems) {
      aviso('GET /elementos', `${elementos.length} elems, NINGUNO con foto_hash`);
    } else {
      mal('GET /elementos', `length=${elementos?.length}, conHash=${conHash}`);
    }

    const sala0 = salas[0].id;
    const rSala = await pedir(`/salas/${sala0}/elementos`);
    const deSala = await cuerpo(rSala);
    const bienDeSala = Array.isArray(deSala) && deSala.every((e) => e.sala_id === sala0);
    bienDeSala ? ok(`GET /salas/${sala0}/elementos → ${deSala.length} elems, todos de la sala`) : mal('GET /salas/:id/elementos', JSON.stringify(deSala).slice(0, 100));

    const rHist = await pedir(`/elementos/${elementos[0].id}/historial`);
    const hist = await cuerpo(rHist);
    Array.isArray(hist) ? ok(`GET /elementos/:id/historial → array (${hist.length} filas)`) : mal('GET historial', JSON.stringify(hist).slice(0, 100));

    const rGz = await pedir('/elementos', { headers: { 'Accept-Encoding': 'gzip' } });
    rGz.headers.get('content-encoding') === 'gzip'
      ? ok('listado llega comprimido en gzip')
      : aviso('gzip', `content-encoding=${rGz.headers.get('content-encoding')}`);

    const rPre = await pedir('/elementos', { method: 'OPTIONS', headers: { 'Origin': 'https://fablab-web.onrender.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    const preOk = rPre.status === 204 && (rPre.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization');
    preOk ? ok('CORS preflight → 204 y permite Authorization') : mal('CORS preflight', `${rPre.status} allow-headers=${rPre.headers.get('access-control-allow-headers')}`);

    const rIdInexistente = await pedir('/elementos/999999/historial');
    rIdInexistente.status === 404
      ? ok('historial de elemento inexistente → 404 (antes 200 []: parecía no tener traslados)')
      : mal('historial inexistente', `${rIdInexistente.status}`);

    const rSalaMala = await pedir('/salas/abc/elementos');
    rSalaMala.status === 400 ? ok('GET /salas/abc/elementos → 400') : mal('sala inválida', `${rSalaMala.status}`);
    const rSalaFloat = await pedir('/salas/1.5/elementos');
    rSalaFloat.status === 400 ? ok('GET /salas/1.5/elementos → 400 (id no entero)') : mal('sala no entera', `${rSalaFloat.status}`);
    const rHistFloat = await pedir('/elementos/1.5/historial');
    rHistFloat.status === 400 ? ok('GET /elementos/1.5/historial → 400 (id no entero)') : mal('historial no entero', `${rHistFloat.status}`);
  }

  // --- B. Fotos: contrato HTTP ---
  seccion('B. Fotos (contrato HTTP)');
  {
    const rE = await pedir('/elementos');
    const elementos = await rE.json();
    const con = elementos.find((e) => e.foto_hash);
    const sin = elementos.find((e) => !e.foto_hash);

    if (con) {
      const { etag } = await probarContratoFotos({ id: con.id, marca: `foto real ${con.id}` });

      const otro = elementos.find((e) => e.foto_hash && e.id !== con.id);
      if (otro) {
        const rDos = await pedir(`/elementos/${otro.id}/foto`);
        const bufDos = Buffer.from(await rDos.arrayBuffer());
        const etagDos = rDos.headers.get('etag');
        const sha1Dos = createHash('sha1').update(bufDos).digest('hex').slice(0, 16);
        if (etagDos !== `"${sha1Dos}"`) {
          mal('ETag segundo elemento', `${etagDos} ≠ sha1 ${sha1Dos}`);
        } else if (etagDos === etag) {
          aviso('dos elementos comparten ETag', `mismo hash en ${con.id} y ${otro.id}: correcto si ambos tienen la misma foto (demo)`);
        } else {
          ok('cada foto sirve su propio ETag (hash por contenido)');
        }
      } else {
        aviso('ETags distintos', 'solo hay un elemento con foto en esta base; se omite');
      }
    } else {
      aviso('fotos reales', 'la base no tiene ninguna foto: el contrato HTTP se prueba sobre la foto temporal del QA en la sección C');
    }

    const rFoto404 = await pedir('/elementos/999999/foto');
    rFoto404.status === 404 ? ok('foto de id inexistente → 404') : mal('foto inexistente', `${rFoto404.status}`);
    const rFotoAbc = await pedir('/elementos/abc/foto');
    rFotoAbc.status === 400 ? ok('foto de id no numérico → 400') : mal('id no numérico', `${rFotoAbc.status}`);
    const rFotoFloat = await pedir('/elementos/1.5/foto');
    rFotoFloat.status === 400 ? ok('foto de id no entero (1.5) → 400') : mal('id no entero', `${rFotoFloat.status}`);
    if (sin) {
      const rSin = await pedir(`/elementos/${sin.id}/foto`);
      rSin.status === 404 ? ok(`foto de elemento sin foto (id ${sin.id}) → 404`) : mal('foto sin foto', `${rSin.status}`);
    } else {
      aviso('elemento sin foto', 'todos los elementos tienen foto; el 404 sin foto se prueba con el QA de la sección C');
    }
  }

  // --- C. Escrituras sobre elementos QA temporales ---
  seccion('C. Escrituras (elementos QA temporales)');
  const codigosQA = [];
  let salaDestino;
  try {
    // Limpieza de corridas anteriores
    const rPrev = await pedir('/elementos');
    const previos = (await rPrev.json()).filter((e) => String(e.codigo).startsWith(PREFIJO));
    for (const p of previos) {
      await pedir(`/elementos/${encodeURIComponent(p.codigo)}`, { method: 'DELETE', headers: auth() });
      console.log(`  (limpieza) borrado resto de corrida anterior: ${p.codigo}`);
    }

    // Sin token → 401
    const rSinTok = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sala_id: salas[0].id, codigo: 'X' }) });
    rSinTok.status === 401 ? ok('POST sin token → 401') : mal('POST sin token', `${rSinTok.status}`);
    const rTokMal = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer equivocado' }, body: JSON.stringify({ sala_id: salas[0].id, codigo: 'X' }) });
    rTokMal.status === 401 ? ok('POST con token equivocado → 401') : mal('token equivocado', `${rTokMal.status}`);

    // Alta
    const codigo = `${PREFIJO}${SELLO}`;
    codigosQA.push(codigo);
    const rAlta = await pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ sala_id: salas[0].id, codigo, detalle: `Elemento QA ${SELLO}`, estado: 'QA' }),
    });
    const alta = await cuerpo(rAlta);
    rAlta.status === 201 && alta.id ? ok(`POST /elementos → 201, id ${alta.id}`) : mal('alta', `${rAlta.status} ${JSON.stringify(alta).slice(0, 120)}`);
    const idQA = alta.id;

    // Duplicado: mismo codigo
    const rDup = await pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ sala_id: salas[0].id, codigo }),
    });
    const dupTxt = await cuerpo(rDup);
    rDup.status === 409
      ? ok(`alta duplicada → 409 (${dupTxt?.error ?? ''})`)
      : mal('alta duplicada', `${rDup.status}: ${JSON.stringify(dupTxt).slice(0, 100)}`);

    // Validaciones de alta
    const rSinCod = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ sala_id: salas[0].id }) });
    rSinCod.status === 400 ? ok('alta sin codigo → 400') : mal('alta sin codigo', `${rSinCod.status}`);
    const rSinSala = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ codigo: `${PREFIJO}SINSALA` }) });
    rSinSala.status === 400 ? ok('alta sin sala_id → 400') : mal('alta sin sala', `${rSinSala.status}`);
    const rSalaFantasma = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ sala_id: 999999, codigo: `${PREFIJO}FANTASMA` }) });
    const fantasmaTxt = await cuerpo(rSalaFantasma);
    rSalaFantasma.status === 404 ? ok('alta con sala inexistente → 404 (no 500 de FK)') : mal('sala inexistente', `${rSalaFantasma.status} ${JSON.stringify(fantasmaTxt).slice(0, 100)}`);
    const rSalaFloat = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ sala_id: 1.5, codigo: `${PREFIJO}FLOAT` }) });
    rSalaFloat.status === 400 ? ok('alta con sala_id no entero → 400') : mal('sala_id no entero', `${rSalaFloat.status}`);

    // Endurecimiento del borde HTTP (2026-09-24): JSON roto y cuerpo gigante.
    const rJsonRoto = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: '{"sala_id": ' });
    rJsonRoto.status === 400 ? ok('cuerpo con JSON roto → 400 (no 500)') : mal('JSON roto', `${rJsonRoto.status}`);

    const cuerpoGigante = JSON.stringify({ sala_id: null, blob: 'a'.repeat(2 * 1024 * 1024) });
    const rCuerpoGig = await pedir('/elementos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: cuerpoGigante });
    rCuerpoGig.status === 413
      ? ok(`cuerpo de ${(cuerpoGigante.length / 1048576).toFixed(1)} MB → 413 (tope 1 MB; antes se bufferizaba entero)`)
      : mal('tope de cuerpo', `${rCuerpoGig.status}`);

    // Carrera de códigos: sin lock, el SELECT→INSERT dejaba pasar varias altas
    // simultáneas con el mismo código (TOCTOU). Con el lock, debe crearse UNA.
    const codigoCarrera = `${PREFIJO}${SELLO}C`;
    const rCarrera = await Promise.all(Array.from({ length: 5 }, () => pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ sala_id: salas[0].id, codigo: codigoCarrera, detalle: 'QA carrera' }),
    })));
    const estados = rCarrera.map((r) => r.status);
    const creados = estados.filter((s) => s === 201).length;
    const rechazados = estados.filter((s) => s === 409).length;
    creados === 1 && rechazados === 4
      ? ok('5 altas simultáneas con el mismo código → 1×201 y 4×409 (sin carrera)')
      : mal('carrera de códigos', `201:${creados} 409:${rechazados} · estados ${estados.join(',')}`);

    // Edición
    const rPut = await pedir(`/elementos/${idQA}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ observaciones: `QA edit ${SELLO}` }) });
    const putJ = await cuerpo(rPut);
    rPut.status === 200 && putJ.elemento?.observaciones === `QA edit ${SELLO}`
      ? ok('PUT edita observaciones y devuelve el elemento actualizado')
      : mal('PUT', `${rPut.status} ${JSON.stringify(putJ).slice(0, 120)}`);

    const rPut404 = await pedir('/elementos/999999', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ estado: 'x' }) });
    rPut404.status === 404 ? ok('PUT de id inexistente → 404') : mal('PUT 404', `${rPut404.status}`);
    const rPutFloat = await pedir('/elementos/1.5', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ estado: 'x' }) });
    rPutFloat.status === 400 ? ok('PUT con id no entero → 400') : mal('PUT id no entero', `${rPutFloat.status}`);
    const rPutSinCampos = await pedir(`/elementos/${idQA}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth() }, body: '{}' });
    rPutSinCampos.status === 400 ? ok('PUT sin campos → 400 con lista de editables') : mal('PUT sin campos', `${rPutSinCampos.status}`);

    // Traslado (a la segunda sala; si el lab tiene 1 sola sala, se omite)
    if (salas.length > 1) {
      salaDestino = salas[1].id;
      const rTr = await pedir('/traslados', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ elementoId: idQA, salaNuevaId: salaDestino, nota: 'QA' }) });
      rTr.status === 201 ? ok('POST /traslados → 201') : mal('traslado', `${rTr.status} ${JSON.stringify(await cuerpo(rTr)).slice(0, 120)}`);

      const rHistQA = await pedir(`/elementos/${idQA}/historial`);
      const histQA = await cuerpo(rHistQA);
      // El server expone snake_case: sala_anterior / sala_nueva.
      histQA.length >= 1 && histQA[0].sala_nueva === salas[1].nombre
        ? ok(`historial refleja el traslado (${histQA[0].sala_anterior ?? '—'} → ${histQA[0].sala_nueva})`)
        : mal('historial traslado', JSON.stringify(histQA).slice(0, 140));

      const rTrMisma = await pedir('/traslados', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ elementoId: idQA, salaNuevaId: salaDestino }) });
      rTrMisma.status === 409 ? ok('traslado a la misma sala → 409') : mal('misma sala', `${rTrMisma.status}`);
      const rTr404 = await pedir('/traslados', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ elementoId: 999999, salaNuevaId: salaDestino }) });
      rTr404.status === 404 ? ok('traslado de elemento inexistente → 404') : mal('traslado 404', `${rTr404.status}`);
      const rTrSala = await pedir('/traslados', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ elementoId: idQA, salaNuevaId: 999999 }) });
      rTrSala.status === 404 ? ok('traslado a sala inexistente → 404 (no 500 de FK)') : mal('traslado sala fantasma', `${rTrSala.status}`);
      const rTrFloat = await pedir('/traslados', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ elementoId: 1.5, salaNuevaId: salaDestino }) });
      rTrFloat.status === 400 ? ok('traslado con elementoId no entero → 400') : mal('traslado id no entero', `${rTrFloat.status}`);
    } else {
      aviso('traslados', 'solo hay 1 sala; no se puede probar el movimiento');
    }

    // Código: asignar a elemento que ya tiene → 409
    const rCod = await pedir(`/elementos/${idQA}/codigo`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ codigo: `${PREFIJO}NUEVO` }) });
    rCod.status === 409 ? ok('asignar código a elemento con código → 409') : mal('asignar código', `${rCod.status}`);

    // Foto sobre el QA: subir la demo (válido), PNG (inválido), gigante (413), mini>foto (400)
    const fotoWebp = readFileSync(new URL('./demo-foto/foto.webp', import.meta.url));
    const miniWebp = readFileSync(new URL('./demo-foto/miniatura.webp', import.meta.url));
    const b64 = (b) => b.toString('base64');
    const fotoUrlQA = `/elementos/${idQA}/foto`;

    const rSinFoto = await pedir(fotoUrlQA);
    rSinFoto.status === 404 ? ok('foto antes de subir nada → 404') : mal('foto vacía', `${rSinFoto.status}`);

    const rFoto = await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(fotoWebp), miniatura: b64(miniWebp), ancho: 800, alto: 800 }),
    });
    const fotoJ = await cuerpo(rFoto);
    rFoto.status === 201 && fotoJ.hash ? ok(`POST foto → 201, hash ${fotoJ.hash} (${fotoJ.bytes} B)`) : mal('POST foto', `${rFoto.status} ${JSON.stringify(fotoJ).slice(0, 120)}`);

    const rVer = await pedir(fotoUrlQA);
    rVer.status === 200 && rVer.headers.get('etag') === `"${fotoJ.hash}"`
      ? ok('la foto subida se lee con su ETag')
      : mal('lectura foto subida', `${rVer.status} etag=${rVer.headers.get('etag')}`);

    // Con la foto del QA ya subida, el contrato HTTP se prueba SIEMPRE (haya o
    // no fotos reales en la base).
    await probarContratoFotos({ id: idQA, marca: 'foto QA' });

    // Reemplazo (UPDATE) con un par válido: la demo chica (5.5 KB) como foto y
    // una miniatura aún más chica (scripts/demo-foto/mini-reemplazo.webp).
    const miniReemplazo = readFileSync(new URL('./demo-foto/mini-reemplazo.webp', import.meta.url));
    const rReem = await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(miniWebp), miniatura: b64(miniReemplazo) }),
    });
    rReem.status === 201 ? ok('reemplazar foto (UPDATE) → 201 con hash nuevo') : mal('reemplazo foto', `${rReem.status} ${JSON.stringify(await cuerpo(rReem)).slice(0, 100)}`);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const rPng = await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(png), miniatura: b64(png) }),
    });
    rPng.status === 400 ? ok('bytes PNG declarados webp → 400 por firma') : mal('firma', `${rPng.status}`);

    const gigante = Buffer.concat([fotoWebp, Buffer.alloc(500 * 1024, 0)]);
    const rGig = await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(gigante), miniatura: b64(miniWebp) }),
    });
    rGig.status === 413 ? ok(`foto de ${gigante.length} B → 413 (límite)`): mal('413', `${rGig.status}`);

    const rMiniGrande = await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(miniWebp), miniatura: b64(fotoWebp) }),
    });
    rMiniGrande.status === 400 ? ok('miniatura más pesada que la foto → 400') : mal('mini>foto', `${rMiniGrande.status}`);

    const rDelFoto = await pedir(fotoUrlQA, { method: 'DELETE', headers: auth() });
    rDelFoto.status === 200 ? ok('DELETE foto → 200') : mal('DELETE foto', `${rDelFoto.status}`);
    const rDelFoto2 = await pedir(fotoUrlQA, { method: 'DELETE', headers: auth() });
    rDelFoto2.status === 404 ? ok('DELETE foto dos veces → 404 la segunda') : mal('DELETE foto ×2', `${rDelFoto2.status}`);

    // CASCADE: subir foto y borrar el elemento → la fila de foto debe desaparecer
    await pedir(fotoUrlQA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ mime: 'image/webp', foto: b64(fotoWebp), miniatura: b64(miniWebp) }),
    });

    // Borrado del QA
    const rDel = await pedir(`/elementos/${encodeURIComponent(codigo)}`, { method: 'DELETE', headers: auth() });
    rDel.status === 200 ? ok(`DELETE /elementos/:codigo → 200 (${codigo})`) : mal('DELETE elemento', `${rDel.status}`);
    const rDel2 = await pedir(`/elementos/${encodeURIComponent(codigo)}`, { method: 'DELETE', headers: auth() });
    rDel2.status === 404 ? ok('DELETE dos veces → 404 la segunda') : mal('DELETE ×2', `${rDel2.status}`);

    // El listado ya no lo trae
    const rPost = await pedir('/elementos');
    const queda = (await rPost.json()).some((e) => e.codigo === codigo);
    !queda ? ok('el listado ya no trae el elemento QA') : mal('residuo QA', `${codigo} sigue en el listado`);

    // CASCADE comprobado: recrear el mismo código no debe heredar la foto
    const rReAlta = await pedir('/elementos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({ sala_id: salas[0].id, codigo, detalle: 'QA cascade' }),
    });
    const reAlta = await cuerpo(rReAlta);
    if (rReAlta.status === 201) {
      const rFotoHuerfana = await pedir(`/elementos/${reAlta.id}/foto`);
      rFotoHuerfana.status === 404
        ? ok('CASCADE: al borrar el elemento su foto desapareció')
        : mal('CASCADE foto', `foto accesible tras recrear el id/codigo (${rFotoHuerfana.status})`);
      await pedir(`/elementos/${encodeURIComponent(codigo)}`, { method: 'DELETE', headers: auth() });
    } else {
      mal('re-alta para CASCADE', `${rReAlta.status}`);
    }
  } finally {
    // Limpieza garantizada
    let limpiados = 0;
    try {
      const r = await pedir('/elementos');
      const restos = (await r.json()).filter((e) => String(e.codigo).startsWith(PREFIJO));
      for (const p of restos) {
        const rr = await pedir(`/elementos/${encodeURIComponent(p.codigo)}`, { method: 'DELETE', headers: auth() });
        if (rr.status === 200) limpiados++;
      }
    } catch {}
    if (limpiados) console.log(`  (limpieza final) ${limpiados} elemento(s) QA borrado(s)`);
  }

  // --- D. Export ---
  seccion('D. Export CSV/JSON');
  {
    const rCsv = await pedir('/export/elementos.csv');
    const csvBuf = Buffer.from(await rCsv.arrayBuffer());
    const csvTxt = csvBuf.toString('utf8');
    const filas = csvTxt.trim().split('\n').length;
    const bom = csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf;
    rCsv.status === 200
      && (rCsv.headers.get('content-type') || '').includes('text/csv')
      && bom
      && filas > 900
      ? ok(`export elementos.csv → ${filas - 1} filas, BOM utf8, attachment`)
      : mal('export csv', `${rCsv.status} ${rCsv.headers.get('content-type')} filas=${filas} bom=${bom}`);

    const rJson = await pedir('/export/elementos.json');
    const jEx = await cuerpo(rJson);
    Array.isArray(jEx) && jEx.length > 900 ? ok(`export elementos.json → ${jEx.length} filas`) : mal('export json', `${rJson.status}`);

    const rTr = await pedir('/export/traslados.csv');
    const trTxt = await rTr.text();
    // Solo el header es válido (o cuerpo vacío): una base nueva no tiene
    // traslados todavía, y sin filas el CSV no tiene ni columnas.
    rTr.status === 200 && /^[a-z_,\s]*$/i.test(trTxt.trim().split('\n')[0] || '')
      ? ok(`export traslados.csv → header + ${Math.max(0, trTxt.trim().split('\n').length - 1)} filas`)
      : mal('export traslados', `${rTr.status}`);

    const rMalo = await pedir('/export/otracosa.csv');
    rMalo.status === 404 ? ok('export desconocido → 404') : mal('export desconocido', `${rMalo.status}`);
  }

  // --- Resumen ---
  const segs = ((Date.now() - tGlobal0) / 1000).toFixed(1);
  console.log(`\n========================================`);
  console.log(`RESULTADO: ${pass} OK · ${fail} FALLOS · ${avisos.length} avisos (${segs}s)`);
  if (avisos.length) avisos.forEach((a) => console.log(`  ⚠ ${a}`));
  if (fallos.length) {
    console.log('FALLOS:');
    fallos.forEach((f) => console.log(`  ✘ ${f}`));
    process.exit(1);
  }
})();
