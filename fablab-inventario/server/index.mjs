import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { gzipSync } from 'node:zlib';
import mysql from 'mysql2/promise';
import {
  listarSalas,
  listarElementos,
  listarElementosTotales,
  registrarTraslado,
  historialElemento,
  agregarElemento,
  eliminarElemento,
  actualizarElemento,
  asignarCodigo,
  exportarElementos,
  exportarTraslados,
  cerrarPools,
} from '../importer/api.mjs';
import { conexionDesdeEnv } from '../importer/importar.mjs';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// --- Helpers ---

// Respuestas >1KB se comprimen si el cliente acepta gzip: el JSON del
// inventario (916 elementos ≈ 120KB) baja a ~20KB — menos de la mitad del
// tiempo de transferencia sobre la red del campus.
const GZIP_MIN_BYTES = 1024;

// Authorization DEBE estar en la lista: las escrituras mandan 'Bearer <token>',
// y un header no simple obliga al navegador a hacer preflight. Si el preflight
// no lo permite, el navegador bloquea el POST antes de enviarlo (el error que
// ve el usuario es 'header authorization is not allowed by
// Access-Control-Allow-Headers'). Aplica al preflight y a toda respuesta.
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization';

function json(res, status, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const acceptsGzip = String(res.req?.headers['accept-encoding'] || '').includes('gzip');
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
  };
  if (acceptsGzip && body.length >= GZIP_MIN_BYTES) {
    const gz = gzipSync(body);
    res.writeHead(status, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      Vary: 'Accept-Encoding',
    });
    res.end(gz);
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Respuesta CSV con BOM para que Excel respete los acentos (utf8 → Latin-1 look).
function csv(res, filename, filas) {
  const cols = filas.length ? Object.keys(filas[0]) : [];
  const escape = (v) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [
    cols.join(','),
    ...filas.map((f) => cols.map((c) => escape(f[c])).join(',')),
  ].join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end('\ufeff' + body);
}

function notFound(res) {
  json(res, 404, { error: 'No encontrado' });
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// --- Escrituras protegidas (opt-in) ---
// La API es pública de lectura; las escrituras también lo eran, o sea que
// cualquiera con la URL podía editar/borrar el inventario desde la consola del
// navegador. API_TOKEN vacío (default) = comportamiento anterior, nada se rompe
// en deploys existentes. Con API_TOKEN=... en Render, POST/PUT/DELETE exigen
// el header 'Authorization: Bearer <token>' y devuelven 401/403 si falta.
const API_TOKEN = process.env.API_TOKEN || '';

function escribeAutorizado(req) {
  if (!API_TOKEN) return true;
  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return Boolean(m) && m[1].trim() === API_TOKEN;
}

function noAutorizado(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'WWW-Authenticate': 'Bearer',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ error: 'Escritura requiere Authorization: Bearer <API_TOKEN>' }));
}

// --- Routes ---

async function handleReq(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    });
    res.end();
    return;
  }

  const { pathname } = parseUrl(req.url, true);
  const parts = pathname.split('/').filter(Boolean);

  try {
    // POST/PUT/DELETE requieren token si API_TOKEN está configurado.
    if (req.method !== 'GET' && req.method !== 'OPTIONS' && !escribeAutorizado(req)) {
      return noAutorizado(res);
    }

    // GET /health  →  healthcheck para deploys (Render, etc.)
    if (req.method === 'GET' && parts.join('/') === 'health') {
      return json(res, 200, { ok: true, service: 'fablab-api' });
    }

    // GET /api/salas  →  listar todas las salas con edificio + conteo
    if (req.method === 'GET' && parts.join('/') === 'api/salas') {
      const salas = await listarSalas(conexionDesdeEnv());
      return json(res, 200, salas);
    }

    // GET /api/elementos  →  TODO el inventario en una sola respuesta
    // (el cliente antes hacía 1 + N peticiones, una por sala, y cada una
    // pagaba handshake TLS contra la BD cloud)
    if (req.method === 'GET' && parts.join('/') === 'api/elementos') {
      const elementos = await listarElementosTotales(conexionDesdeEnv());
      return json(res, 200, elementos);
    }

    // GET /api/salas/:id/elementos  →  elementos de una sala (por id numérico)
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'salas' && parts[3] === 'elementos') {
      const salaId = Number(parts[2]);
      if (!Number.isFinite(salaId)) return badRequest(res, 'ID de sala inválido');
      const elementos = await listarElementos(salaId, conexionDesdeEnv());
      return json(res, 200, elementos);
    }

    // GET /api/elementos/:id/historial  →  historial de traslados
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'elementos' && parts[3] === 'historial') {
      const elementoId = Number(parts[2]);
      if (!Number.isFinite(elementoId)) return badRequest(res, 'ID de elemento inválido');
      const historial = await historialElemento(elementoId, conexionDesdeEnv());
      return json(res, 200, historial);
    }

    // POST /api/traslados  →  registrar traslado (transaccional)
    if (req.method === 'POST' && parts.join('/') === 'api/traslados') {
      const body = await readBody(req);
      if (!body.elementoId || !body.salaNuevaId) {
        return badRequest(res, 'elementoId y salaNuevaId son obligatorios');
      }
      const result = await registrarTraslado(
        { elementoId: body.elementoId, salaNuevaId: body.salaNuevaId, nota: body.nota ?? null },
        conexionDesdeEnv(),
      );
      return json(res, 201, result);
    }

    // POST /api/elementos  →  agregar nuevo elemento
    if (req.method === 'POST' && parts.join('/') === 'api/elementos') {
      const body = await readBody(req);
      if (!body.sala_id) return badRequest(res, 'sala_id es obligatorio');
      if (!body.codigo) return badRequest(res, 'codigo es obligatorio');
      const result = await agregarElemento(body, conexionDesdeEnv());
      return json(res, 201, result);
    }

    // PUT /api/elementos/:id  →  modificar elemento (detalle, serial, estado…)
    if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'elementos' && parts.length === 3 && /^\d+$/.test(parts[2])) {
      const body = await readBody(req);
      const result = await actualizarElemento(Number(parts[2]), body, conexionDesdeEnv());
      return json(res, 200, result);
    }

    // POST /api/elementos/:id/codigo  →  asignar código a un elemento que no
    // tiene (los importados de la hoja pueden venir sin código, y sin código no
    // hay Data Matrix). El server rechaza con 409 si el elemento ya tiene uno.
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'elementos' && parts[3] === 'codigo') {
      const elementoId = Number(parts[2]);
      if (!Number.isFinite(elementoId)) return badRequest(res, 'ID de elemento inválido');
      const body = await readBody(req);
      const result = await asignarCodigo(elementoId, body.codigo, conexionDesdeEnv());
      return json(res, 201, result);
    }

    // GET /api/export/elementos.csv|.json y /api/export/traslados.csv|.json
    // (la extensión llega pegada al segmento: /api/export/elementos.csv → parts[2] = "elementos.csv")
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'export') {
      const destino = /^(elementos|traslados)\.(csv|json)$/.exec(parts[2] || '');
      if (destino) {
        const filas = destino[1] === 'elementos'
          ? await exportarElementos(conexionDesdeEnv())
          : await exportarTraslados(conexionDesdeEnv());
        if (destino[2] === 'csv') return csv(res, destino[0], filas);
        return json(res, 200, filas);
      }
    }

    // DELETE /api/elementos/:codigo  →  eliminar elemento por código
    if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'elementos' && parts.length === 3) {
      const codigo = decodeURIComponent(parts[2]);
      const result = await eliminarElemento(codigo, conexionDesdeEnv());
      if (!result.deleted) return notFound(res);
      return json(res, 200, result);
    }

    notFound(res);
  } catch (e) {
    // ErrorApi (importer/api.mjs) trae estatus de cliente: 400 campo inválido,
    // 404 inexistente, 409 conflicto. Lo demás sí es un 500 del servidor.
    const status = Number.isFinite(e?.status) ? e.status : 500;
    if (status >= 500) console.error(`[api] ${req.method} ${pathname}:`, e.message);
    json(res, status, { error: e.message });
  }
}

// Graceful shutdown: cierra el pool para no cortar queries en curso
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[api] ${sig} recibido — cerrando pool y saliendo`);
    try { await cerrarPools(); } catch {}
    process.exit(0);
  });
}

const server = createServer(handleReq);
server.listen(PORT, HOST, () => {
  console.log(`FabLab API escuchando en http://${HOST}:${PORT}`);
  console.log(`  GET    /api/salas`);
  console.log(`  GET    /api/elementos`);
  console.log(`  GET    /api/salas/:id/elementos`);
  console.log(`  GET    /api/elementos/:id/historial`);
  console.log(`  POST   /api/elementos`);
  console.log(`  PUT    /api/elementos/:id`);
  console.log(`  POST   /api/elementos/:id/codigo  (solo si el elemento no tiene código)`);
  console.log(`  GET    /api/export/{elementos,traslados}.{csv,json}`);
  console.log(`  DELETE /api/elementos/:codigo`);
  console.log(`  POST   /api/traslados`);

  iniciarKeepAlive();
});

// --- Keep-alive (free tier de Render duerme tras ~15 min sin tráfico) ---
// El servicio se hace ping a sí mismo cada 10 min vía su URL pública.
// Se usa /api/salas (no /health) a propósito: genera una consulta real en
// MySQL, lo que también mantiene activa la BD de Aiven y evita su apagado
// por inactividad. RENDER_EXTERNAL_URL la inyecta Render automáticamente
// en despliegues; en local queda undefined y el ping no arranca (no-op).
const KEEP_ALIVE_MS = 10 * 60 * 1000;

function iniciarKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  const host = url.replace(/^https?:\/\//, '');
  setInterval(() => {
    const t0 = Date.now();
    // 1 reintento tras 20s: si el ping mismo despertó el servicio, el primer
    // intento llega 502/503 y el log se llenaría de falsas alarmas de Aiven.
    const ping = () => fetch(`${url}/api/salas`);
    ping()
      .then((r) => (r.ok ? r : new Promise((ok) => setTimeout(ok, 20_000)).then(ping)))
      .then((r) => {
        if (r.ok) {
          console.log(`[keep-alive] ping ${host}/api/salas → ${r.status} (${Date.now() - t0}ms)`);
        } else {
          console.error(`[keep-alive] ping respondió ${r.status} — ¿se apagó la BD de Aiven? Revisar consola de Aiven.`);
        }
      })
      .catch((e) => console.error(`[keep-alive] fallo ping:`, e.message));
  }, KEEP_ALIVE_MS);
  console.log(`[keep-alive] activo: ping a ${host}/api/salas cada ${KEEP_ALIVE_MS / 60000} min`);
}
