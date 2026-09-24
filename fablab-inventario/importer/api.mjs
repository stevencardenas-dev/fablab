// Lectura de la base para el frontend, sobre el esquema normalizado
// (edificios -> salas -> elementos, mas traslados). Ver importer/normalizado.mjs.
import mysql from 'mysql2/promise';
import { conexionDesdeEnv } from './importar.mjs';

// Error con estatus HTTP. El server lo usa para no responder 500 a errores de
// cliente (campo faltante, id inexistente, conflicto). Sin estatus = 500.
export class ErrorApi extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ErrorApi';
    this.status = status;
  }
}

// --- Pool de conexiones ---
// Antes cada request abria y cerraba su propia conexion: con MySQL por WAN+TLS
// (Aiven) cada handshake cuesta ~1-2s, y el inventario completo (11 salas) se
// tornaba lentisimo. El pool reutiliza conexiones calientes por proceso.
const pools = new Map(); // cfg serializado -> pool

function poolDesde(cfg) {
  const key = JSON.stringify(cfg);
  let pool = pools.get(key);
  if (!pool) {
    pool = mysql.createPool({ ...cfg, connectionLimit: 5 });
    pools.set(key, pool);
  }
  return pool;
}

async function conectar(cfg, fn) {
  const pool = poolDesde(cfg);
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

export async function cerrarPools() {
  for (const pool of pools.values()) await pool.end();
  pools.clear();
}

// --- Cache TTL en memoria ---
// Las lecturas del inventario cambian poco (el Excel se importa a mano);
// responderlas de memoria ahorra el round-trip a Aiven (que aunque con pool
// cuesta ~50-150ms por query sobre WAN). Toda escritura invalida.
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key -> { value, expires }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

export function invalidarCache() {
  cache.clear();
}

export async function listarElementosTotales(cfg = conexionDesdeEnv()) {
  const hit = cacheGet('elementos:all');
  if (hit) return hit;
  const filas = await conectar(cfg, async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad
       FROM elementos ORDER BY sala_id, id`,
    );
    return rows;
  });
  cacheSet('elementos:all', filas);
  return filas;
}

// Salas con su edificio y cuantos elementos tiene cada una.
export async function listarSalas(cfg = conexionDesdeEnv()) {
  const hit = cacheGet('salas');
  if (hit) return hit;
  const filas = await conectar(cfg, async (conn) => {
    const [rows] = await conn.query(`
      SELECT s.id, s.nombre, e.nombre AS edificio, COUNT(el.id) AS elementos
      FROM salas s
      JOIN edificios e ON e.id = s.edificio_id
      LEFT JOIN elementos el ON el.sala_id = s.id
      GROUP BY s.id, s.nombre, e.nombre
      ORDER BY e.nombre, s.nombre`);
    return rows;
  });
  cacheSet('salas', filas);
  return filas;
}

// sala: id numerico o nombre. El nombre es UNIQUE solo por edificio,
// asi que con nombre repetido en dos edificios hay que pasar el id.
export async function listarElementos(sala, cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const porId = typeof sala === 'number' || /^\d+$/.test(String(sala));
    const [salas] = await conn.query(
      `SELECT id FROM salas WHERE ${porId ? 'id = ?' : 'nombre = ?'}`,
      [sala],
    );
    if (!salas.length) throw new ErrorApi(`La sala "${sala}" no existe`, 404);
    if (salas.length > 1) throw new ErrorApi(`"${sala}" existe en mas de un edificio; use el id`, 400);
    const [filas] = await conn.query(
      `SELECT id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad
       FROM elementos WHERE sala_id = ? ORDER BY id`,
      [salas[0].id],
    );
    return filas;
  });
}

// Registra un traslado y mueve el elemento. Las dos cosas o ninguna.
export async function registrarTraslado({ elementoId, salaNuevaId, nota = null }, cfg = conexionDesdeEnv()) {
  invalidarCache();
  return conectar(cfg, async (conn) => {
    await conn.beginTransaction();
    try {
      const [[el]] = await conn.query('SELECT sala_id FROM elementos WHERE id = ?', [elementoId]);
      if (!el) throw new ErrorApi(`El elemento ${elementoId} no existe`, 404);
      if (el.sala_id === salaNuevaId) throw new ErrorApi('El elemento ya esta en esa sala', 409);
      const [res] = await conn.query(
        'INSERT INTO traslados (elemento_id, sala_anterior_id, sala_nueva_id, nota) VALUES (?, ?, ?, ?)',
        [elementoId, el.sala_id, salaNuevaId, nota],
      );
      await conn.query('UPDATE elementos SET sala_id = ? WHERE id = ?', [salaNuevaId, elementoId]);
      await conn.commit();
      return { id: res.insertId, salaAnteriorId: el.sala_id, salaNuevaId };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

export async function historialElemento(elementoId, cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT t.id, t.fecha, t.nota, a.nombre AS sala_anterior, n.nombre AS sala_nueva
      FROM traslados t
      LEFT JOIN salas a ON a.id = t.sala_anterior_id
      JOIN salas n ON n.id = t.sala_nueva_id
      WHERE t.elemento_id = ? ORDER BY t.fecha, t.id`, [elementoId]);
    return filas;
  });
}

// Agrega un elemento nuevo a la base. El codigo es único.
export async function agregarElemento(elemento, cfg = conexionDesdeEnv()) {
  invalidarCache();
  return conectar(cfg, async (conn) => {
    const [res] = await conn.query(
      `INSERT INTO elementos (sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        elemento.sala_id,
        elemento.codigo ?? null,
        elemento.detalle ?? null,
        elemento.serial ?? null,
        elemento.inventario ?? null,
        elemento.estado ?? null,
        elemento.observaciones ?? null,
        elemento.cantidad ?? null,
      ],
    );
    return { id: res.insertId, ...elemento };
  });
}

// Elimina un elemento por su codigo.
export async function eliminarElemento(codigo, cfg = conexionDesdeEnv()) {
  invalidarCache();
  return conectar(cfg, async (conn) => {
    const [res] = await conn.query('DELETE FROM elementos WHERE codigo = ?', [codigo]);
    return { deleted: res.affectedRows > 0, codigo };
  });
}

// Modifica los campos editables de un elemento por id. El codigo NO se toca
// (es el identificador impreso en el Data Matrix); mover de sala es un traslado.
const CAMPOS_EDITABLES = ['detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'];

export async function actualizarElemento(id, campos, cfg = conexionDesdeEnv()) {
  invalidarCache();
  const set = CAMPOS_EDITABLES.filter((c) => campos[c] !== undefined);
  if (!set.length) throw new ErrorApi(`Campos editables: ${CAMPOS_EDITABLES.join(', ')}`, 400);
  return conectar(cfg, async (conn) => {
    await conn.query(
      `UPDATE elementos SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...set.map((c) => campos[c]), id],
    );
    // affectedRows=0 también cuando el valor enviado es idéntico al guardado
    // (MySQL cuenta filas *cambiadas*), así que la existencia se decide con el
    // SELECT de abajo, no con affectedRows.
    const [[elemento]] = await conn.query(
      'SELECT id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad FROM elementos WHERE id = ?',
      [id],
    );
    if (!elemento) throw new ErrorApi(`El elemento ${id} no existe`, 404);
    return { updated: true, elemento };
  });
}

// --- Asignar código a un elemento importado sin código ---
// La hoja de cálculo trae filas sin N° de inventario (hoy: 35 materiales de
// CNC), y sin código no hay Data Matrix que imprimir ni forma de escanear el
// elemento. Esto es lo único que toca `codigo` — y SOLO para rellenar vacíos:
// un código existente es el identificador ya impreso en la etiqueta, así que
// sobrescribirlo invalidaría las etiquetas pegadas y la búsqueda por código.
//
// Nota: `codigo` NO tiene índice UNIQUE en el esquema (por eso existen
// duplicados heredados como IOT-79), así que la unicidad se verifica con un
// SELECT dentro de la misma transacción de lectura/escritura de la conexión.
const FORMATO_CODIGO = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

export function normalizarCodigo(codigo) {
  const limpio = String(codigo ?? '').trim().toUpperCase();
  if (!FORMATO_CODIGO.test(limpio)) {
    throw new ErrorApi('Código inválido: de 2 a 20 caracteres A-Z, 0-9 y guiones', 400);
  }
  return limpio;
}

/**
 * Decide si se puede asignar el código. Pura: sin base, así el self-check la
 * cubre sin MySQL. `idConEseCodigo` es el id que ya usa ese código, si hay uno.
 */
export function validarAsignacion({ id, codigoActual, codigoNuevo, idConEseCodigo }) {
  const nuevo = normalizarCodigo(codigoNuevo);
  if (codigoActual != null && String(codigoActual).trim() !== '') {
    throw new ErrorApi(
      `El elemento ${id} ya tiene código (${codigoActual}); no se sobrescribe el identificador impreso`,
      409,
    );
  }
  if (idConEseCodigo != null && Number(idConEseCodigo) !== Number(id)) {
    throw new ErrorApi(`El código ${nuevo} ya está en uso por el elemento ${idConEseCodigo}`, 409);
  }
  return nuevo;
}

const COLUMNAS_ELEMENTO = 'id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad';

export async function asignarCodigo(id, codigo, cfg = conexionDesdeEnv()) {
  if (!Number.isFinite(Number(id))) throw new ErrorApi('ID de elemento inválido', 400);
  const nuevo = normalizarCodigo(codigo);
  invalidarCache();
  return conectar(cfg, async (conn) => {
    const [[actual]] = await conn.query('SELECT id, codigo FROM elementos WHERE id = ?', [id]);
    if (!actual) throw new ErrorApi(`El elemento ${id} no existe`, 404);
    const [[ocupado]] = await conn.query('SELECT id FROM elementos WHERE codigo = ? LIMIT 1', [nuevo]);
    const asignable = validarAsignacion({
      id,
      codigoActual: actual.codigo,
      codigoNuevo: nuevo,
      idConEseCodigo: ocupado?.id ?? null,
    });
    await conn.query('UPDATE elementos SET codigo = ? WHERE id = ?', [asignable, id]);
    const [[elemento]] = await conn.query(
      `SELECT ${COLUMNAS_ELEMENTO} FROM elementos WHERE id = ?`,
      [id],
    );
    return { asignado: true, elemento };
  });
}

// --- Export completo (CSV/JSON) ---
// Elementos con su sala y edificio; traslados con codigo de elemento y nombres de sala.

export async function exportarElementos(cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT el.id, el.codigo, el.detalle, el.serial, el.inventario, el.estado,
             el.observaciones, el.cantidad, s.nombre AS sala, e.nombre AS edificio
      FROM elementos el
      LEFT JOIN salas s ON s.id = el.sala_id
      LEFT JOIN edificios e ON e.id = s.edificio_id
      ORDER BY e.nombre, s.nombre, el.id`);
    return filas;
  });
}

export async function exportarTraslados(cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT t.id, t.fecha, el.codigo, el.detalle,
             a.nombre AS sala_anterior, n.nombre AS sala_nueva, t.nota
      FROM traslados t
      JOIN elementos el ON el.id = t.elemento_id
      LEFT JOIN salas a ON a.id = t.sala_anterior_id
      JOIN salas n ON n.id = t.sala_nueva_id
      ORDER BY t.fecha, t.id`);
    return filas;
  });
}
