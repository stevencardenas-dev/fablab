import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import mysql from 'mysql2/promise';
import {
  listarSalas,
  listarElementos,
  registrarTraslado,
  historialElemento,
  agregarElemento,
  eliminarElemento,
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
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
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  console.log(`  DELETE /api/elementos/:codigo`);
  console.log(`  POST   /api/traslados`);
});
