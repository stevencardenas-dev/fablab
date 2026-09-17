import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import mysql from 'mysql2/promise';
import {
  listarSalas,
  listarElementos,
  registrarTraslado,
  historialElemento,
  agregarElemento,
  actualizarElemento,
  eliminarElemento,
  exportarElementos,
  exportarTraslados,
} from '../importer/api.mjs';
import { conexionDesdeEnv } from '../importer/importar.mjs';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// --- Helpers ---

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
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

// --- Routes ---

async function handleReq(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const { pathname } = parseUrl(req.url, true);
  const parts = pathname.split('/').filter(Boolean);

  try {
    // GET /health  →  healthcheck para deploys (Render, etc.)
    if (req.method === 'GET' && parts.join('/') === 'health') {
      return json(res, 200, { ok: true, service: 'fablab-api' });
    }

    // GET /api/salas  →  listar todas las salas con edificio + conteo
    if (req.method === 'GET' && parts.join('/') === 'api/salas') {
      const salas = await listarSalas(conexionDesdeEnv());
      return json(res, 200, salas);
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

    // GET /api/export/elementos[.csv|.json]  →  inventario completo con sala y edificio
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'export' && parts[2] === 'elementos') {
      const filas = await exportarElementos(conexionDesdeEnv());
      if (parts[3] === 'csv') return csv(res, 'elementos.csv', filas);
      return json(res, 200, filas);
    }

    // GET /api/export/traslados[.csv|.json]  →  historial de traslados con nombres de sala
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'export' && parts[2] === 'traslados') {
      const filas = await exportarTraslados(conexionDesdeEnv());
      if (parts[3] === 'csv') return csv(res, 'traslados.csv', filas);
      return json(res, 200, filas);
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
    console.error(`[api] ${req.method} ${pathname}:`, e.message);
    json(res, 500, { error: e.message });
  }
}

const server = createServer(handleReq);
server.listen(PORT, HOST, () => {
  console.log(`FabLab API escuchando en http://${HOST}:${PORT}`);
  console.log(`  GET    /api/salas`);
  console.log(`  GET    /api/salas/:id/elementos`);
  console.log(`  GET    /api/elementos/:id/historial`);
  console.log(`  POST   /api/elementos`);
  console.log(`  PUT    /api/elementos/:id`);
  console.log(`  DELETE /api/elementos/:codigo`);
  console.log(`  POST   /api/traslados`);
  console.log(`  GET    /api/export/elementos[.csv|.json]`);
  console.log(`  GET    /api/export/traslados[.csv|.json]`);
});
