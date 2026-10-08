// Lectura de la base para el frontend, sobre el esquema normalizado
// (edificios -> salas -> elementos, mas traslados). Ver importer/normalizado.mjs.
import { createHash } from 'node:crypto';
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

// --- Identificadores ---
// Los ids de la API son enteros positivos que quepan en la columna INT. Se
// valida acá para que un id imposible (1.5, abc, 99999999999) responda 400 en
// vez de llegar a la base: con `WHERE id = 1.5` no encuentra nada y el error se
// disfrazaba de 404 (y el historial llegaba a contestar 200 []).
const MAX_ID_INT = 2_147_483_647;

export function idEntero(valor) {
  if (!/^\d+$/.test(String(valor ?? ''))) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_ID_INT ? n : null;
}

/**
 * Decide el borrado por código. Nació porque `codigo` no era único (el duplicado
 * heredado IOT-79) y el borrado hacía `SELECT ... WHERE codigo = ?` sin LIMIT:
 * con dos coincidencias borraba la que devolviera la base primero, o sea una
 * lotería sobre datos reales. Hoy `uq_codigo` hace imposible el caso, pero el
 * guardián se queda: la base degradada (sin UNIQUE) sigue existiendo y borrar
 * por código es destructivo. Devuelve el id a borrar, `null` si no hay nada que
 * borrar, y 409 si es ambiguo. Pura: la cubre el self-check.
 */
export function idUnicoParaCodigo(ids) {
  const lista = (ids || []).map(Number);
  if (!lista.length) return null;
  if (lista.length > 1) {
    throw new ErrorApi(
      `Hay ${lista.length} elementos con ese código (ids ${lista.join(', ')}): el borrado por código es ambiguo, resuelve el duplicado primero`,
      409,
    );
  }
  return lista[0];
}

// --- Pool de conexiones ---
// Antes cada request abria y cerraba su propia conexion: con MySQL por WAN+TLS
// (Aiven) cada handshake cuesta ~1-2s, y el inventario completo (11 salas) se
// tornaba lentisimo. El pool reutiliza conexiones calientes por proceso.
//
// Conexiones TIBIAS: el default de mysql2 cierra conexiones libres a los 60s
// (idleTimeout), y en producción el tráfico llega espaciado — casi cada request
// pagaba handshake TLS completo contra Aiven. maxIdle=connectionLimit +
// idleTimeout alto mantienen 5 conexiones vivas todo el tiempo (a Aiven le da
// igual: 5 conexiones idle no consumen plan); enableKeepAlive evita que NAT/firewall
// suelte el socket por inactividad.
const pools = new Map(); // cfg serializado -> pool

const IDLE_TIMEOUT_MS = 8 * 60 * 1000; // > que el ping keep-alive de Render (10 min) no hace falta: Aiven no cierra por idle agresivo

function poolDesde(cfg) {
  const key = JSON.stringify(cfg);
  let pool = pools.get(key);
  if (!pool) {
    pool = mysql.createPool({
      ...cfg,
      connectionLimit: 5,
      maxIdle: 5, // = connectionLimit: no podar conexiones libres
      idleTimeout: IDLE_TIMEOUT_MS,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });
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

// Sin `foto_hash` (tabla de fotos ausente o inaccesible). El inventario es lo
// que no puede faltar: la app entera se arma con este listado, así que si el
// JOIN falla se sirve igual, sin fotos, con un aviso en el log.
const SQL_ELEMENTOS_SIN_FOTOS = `SELECT el.id, el.sala_id, el.codigo, el.detalle, el.serial, el.inventario,
        el.estado, el.observaciones, el.cantidad, NULL AS foto_hash
 FROM elementos el
 ORDER BY el.sala_id, el.id`;

let avisadoSinFotos = false;

export async function listarElementosTotales(cfg = conexionDesdeEnv()) {
  const hit = cacheGet('elementos:all');
  if (hit) return hit;
  const filas = await conectar(cfg, async (conn) => {
    // `foto_hash` (no la foto): la app sabe que hay imagen y con qué versión
    // pedirla, sin que el listado de 917 elementos arrastre un solo byte de
    // binario. Los BLOB viven en `elemento_fotos` y se piden por elemento.
    try {
      const [rows] = await conn.query(
        `SELECT el.id, el.sala_id, el.codigo, el.detalle, el.serial, el.inventario,
                el.estado, el.observaciones, el.cantidad, f.hash AS foto_hash
       FROM elementos el
       LEFT JOIN elemento_fotos f ON f.elemento_id = el.id
       ORDER BY el.sala_id, el.id`,
      );
      return rows;
    } catch (e) {
      // 1146 = tabla inexistente (asegurarEsquemaFotos no pudo crearla).
      if (e?.errno !== 1146) throw e;
      if (!avisadoSinFotos) {
        avisadoSinFotos = true;
        console.error('[api] falta elemento_fotos: el inventario se sirve SIN fotos. Revisar permisos de la base.');
      }
      const [rows] = await conn.query(SQL_ELEMENTOS_SIN_FOTOS);
      return rows;
    }
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
// Con cache TTL por sala: es la pantalla mas usada de la app (al abrir una
// sala se pide dos veces seguidas: focus + render) y las 2 queries sin cache
// costaban ~140ms sobre WAN. invalidarCache() la limpia en cada escritura.
export async function listarElementos(sala, cfg = conexionDesdeEnv()) {
  const porId = typeof sala === 'number' || /^\d+$/.test(String(sala));
  const cacheKey = `elementos:sala:${sala}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const filas = await conectar(cfg, async (conn) => {
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
  cacheSet(cacheKey, filas);
  return filas;
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
      // Sala destino inexistente: la FK revientaría con 500; mejor un 404 claro.
      const [[destino]] = await conn.query('SELECT id FROM salas WHERE id = ?', [salaNuevaId]);
      if (!destino) throw new ErrorApi(`La sala ${salaNuevaId} no existe`, 404);
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
  // Con cache TTL: se pide en CADA apertura de modal (era +67 ms sobre el piso
  // de red, un join de 3 tablas por WAN). Cualquier escritura ya invalida todo
  // el cache, así que un traslado nuevo se refleja al instante.
  const cacheKey = `historial:${elementoId}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const filas = await conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT t.id, t.fecha, t.nota, a.nombre AS sala_anterior, n.nombre AS sala_nueva
      FROM traslados t
      LEFT JOIN salas a ON a.id = t.sala_anterior_id
      JOIN salas n ON n.id = t.sala_nueva_id
      WHERE t.elemento_id = ? ORDER BY t.fecha, t.id`, [elementoId]);
    // [] por historial vacío es correcto; [] por elemento inexistente era un
    // 200 engañoso (un id mal tecleado parecía no tener traslados). Solo se
    // paga la consulta extra cuando NO hay filas, así el camino caliente sigue
    // con una sola query.
    if (!filas.length) {
      const [[el]] = await conn.query('SELECT id FROM elementos WHERE id = ?', [elementoId]);
      if (!el) throw new ErrorApi(`El elemento ${elementoId} no existe`, 404);
    }
    return filas;
  });
  cacheSet(cacheKey, filas);
  return filas;
}

// --- Unicidad de `codigo` ---
// Historia de esta columna, porque explica su forma actual: nació SIN índice
// (cada búsqueda por código escaneaba los 917 elementos), luego tuvo un índice
// normal con la unicidad verificada a mano por el servidor —y bajo un lock con
// nombre, porque un `SELECT` seguido de `INSERT` tiene ventana de carrera
// (TOCTOU): dos altas simultáneas con el mismo código pasaban las dos—. Todo
// eso existía por UN dato heredado: el Excel original escribió `IOT-79` dos
// veces (una silla y una mesa).
//
// Resuelto el duplicado, la unicidad la garantiza la BASE con un índice UNIQUE:
// el `INSERT`/`UPDATE` falla con 1062 (ER_DUP_ENTRY) si el código ya está en
// uso. Cierra la carrera igual que el lock, sin serializar nada y sin sus
// round-trips extra. `uq_codigo` también sirve las búsquedas por código, así que
// el índice normal anterior queda redundante.
//
// Si la base todavía tiene duplicados, MySQL no deja crear el UNIQUE: el
// arranque lo avisa, se conserva el índice normal y las escrituras vuelven al
// chequeo a mano (estado degradado: se pierde la garantía de carrera, no la
// protección contra duplicados preexistentes).
const DDL_IX_CODIGO = 'CREATE INDEX ix_codigo ON elementos (codigo)';
const DDL_UQ_CODIGO = 'CREATE UNIQUE INDEX uq_codigo ON elementos (codigo)';

// ¿La base garantiza la unicidad? Lo prende `asegurarCodigoUnico()` en el
// arranque del server. Apagado (scripts sueltos, o base con duplicados
// heredados) las escrituras chequean a mano antes de escribir.
let codigoUnicoEnBase = false;

// 1062 (ER_DUP_ENTRY) en `elementos` solo puede ser `uq_codigo` (la otra clave
// única de la tabla es el id, que no se envía). El 409 dice a quién pertenece el
// código: es el dato que hace falta para resolverlo.
async function idDuenoDelCodigo(conn, codigo) {
  if (!codigo) return null;
  const [[dup]] = await conn.query(
    'SELECT id FROM elementos WHERE codigo = ? ORDER BY id LIMIT 1',
    [codigo],
  );
  return dup ? dup.id : null;
}

async function errorCodigoOcupado(conn, codigo) {
  const dueno = await idDuenoDelCodigo(conn, codigo);
  return new ErrorApi(
    `El código ${codigo} ya existe${dueno == null ? '' : ` (elemento ${dueno})`}`,
    409,
  );
}

// Agrega un elemento nuevo a la base. El codigo es único.
export async function agregarElemento(elemento, cfg = conexionDesdeEnv()) {
  invalidarCache();
  return conectar(cfg, async (conn) => {
    // Sala inexistente: sin este check la FK revienta con 500 en vez de un 404
    // entendible (QA 2026-09-24: alta con sala_id=999999 → 500).
    const [[sala]] = await conn.query('SELECT id FROM salas WHERE id = ?', [elemento.sala_id]);
    if (!sala) throw new ErrorApi(`La sala ${elemento.sala_id} no existe`, 404);
    // Base sin UNIQUE (duplicados heredados vivos): única red disponible, con su
    // ventana de carrera. Estado degradado y avisado en el arranque.
    if (!codigoUnicoEnBase) {
      const dueno = await idDuenoDelCodigo(conn, elemento.codigo);
      if (dueno != null) throw new ErrorApi(`El código ${elemento.codigo} ya existe (elemento ${dueno})`, 409);
    }
    try {
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
    } catch (e) {
      if (e?.errno === 1062) throw await errorCodigoOcupado(conn, elemento.codigo);
      throw e;
    }
  });
}

// Elimina un elemento por su codigo. Su historial de traslados se borra con él:
// la FK de traslados NO tiene ON DELETE CASCADE (esquema heredado), así que un
// DELETE directo con historial revienta con 500 (error de FK) — QA 2026-09-24.
export async function eliminarElemento(codigo, cfg = conexionDesdeEnv()) {
  invalidarCache();
  return conectar(cfg, async (conn) => {
    // LIMIT 2 alcanza para saber si el código es ambiguo, y idUnicoParaCodigo
    // decide: 409 si hay más de uno (no se borra nada), null si no hay ninguno.
    const [els] = await conn.query('SELECT id FROM elementos WHERE codigo = ? LIMIT 2', [codigo]);
    const elId = idUnicoParaCodigo(els.map((e) => e.id));
    if (elId == null) return { deleted: false, codigo };
    await conn.beginTransaction();
    try {
      await conn.query('DELETE FROM traslados WHERE elemento_id = ?', [elId]);
      const [res] = await conn.query('DELETE FROM elementos WHERE id = ?', [elId]);
      await conn.commit();
      cacheFotoLimpiarElemento(elId); // el CASCADE borró su fila de foto
      return { deleted: res.affectedRows > 0, codigo };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
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
// Nota: que el código esté libre lo garantiza la base (índice UNIQUE
// `uq_codigo`, ver más abajo); `validarAsignacion` solo queda para la regla de
// negocio de no sobrescribir y para el chequeo a mano de una base degradada.
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
  if (idEntero(id) == null) throw new ErrorApi('ID de elemento inválido', 400);
  const nuevo = normalizarCodigo(codigo);
  invalidarCache();
  return conectar(cfg, async (conn) => {
    const [[actual]] = await conn.query('SELECT id, codigo FROM elementos WHERE id = ?', [id]);
    if (!actual) throw new ErrorApi(`El elemento ${id} no existe`, 404);
    // Regla de negocio (pura, la cubre el self-check): un código existente es el
    // identificador impreso en la etiqueta y no se sobrescribe. El "¿está libre?"
    // lo decide la base con `uq_codigo`; en una base degradada —sin el UNIQUE— se
    // chequea a mano, que es la razón por la que `validarAsignacion` sigue
    // recibiendo `idConEseCodigo`.
    const dueno = codigoUnicoEnBase ? null : await idDuenoDelCodigo(conn, nuevo);
    validarAsignacion({ id, codigoActual: actual.codigo, codigoNuevo: nuevo, idConEseCodigo: dueno });
    try {
      await conn.query('UPDATE elementos SET codigo = ? WHERE id = ?', [nuevo, id]);
    } catch (e) {
      if (e?.errno === 1062) throw await errorCodigoOcupado(conn, nuevo);
      throw e;
    }
    const [[elemento]] = await conn.query(
      `SELECT ${COLUMNAS_ELEMENTO} FROM elementos WHERE id = ?`,
      [id],
    );
    return { asignado: true, elemento };
  });
}

// --- Fotos ---
// Los binarios van en su propia tabla (`elemento_fotos`) y ya reducidos en el
// teléfono, en dos tamaños: el listado del inventario nunca los arrastra (trae
// sólo `foto_hash`) y la app pide la miniatura o la foto cuando las muestra.
// Medidas reales con las que se calibró: 800 px WebP q60 ≈ 26 KB, 200 px ≈ 6 KB
// → ~31 KB por elemento, ~29 MB para los 917 (el plan de Aiven da 1 GB).
// Subir la foto original de la cámara (1-2,5 MB) sería 20-70× más pesado y no
// cabe ni en el disco del plan.
export const LIMITE_FOTO_BYTES = 400 * 1024;
export const LIMITE_MINIATURA_BYTES = 80 * 1024;

// DDL idempotente de la tabla de fotos. Vive aquí (y no sólo en scripts/) para
// que el SERVER pueda asegurar el esquema al arrancar: el listado del
// inventario hace LEFT JOIN con esta tabla, así que si falta en la base viva el
// GET /api/elementos entero falla (y con él la app). En Aiven la tabla no
// existía y no hay credenciales de esa base fuera de Render: el deploy se
// arregla su propio esquema. `npm run migrar:esquema` sigue sirviendo para
// revisar/aplicar a mano, y comparte esta misma definición.
export const DDL_FOTOS = `CREATE TABLE IF NOT EXISTS \`elemento_fotos\` (
  \`elemento_id\` INT NOT NULL PRIMARY KEY,
  \`mime\` VARCHAR(32) NOT NULL,
  \`ancho\` SMALLINT UNSIGNED NULL,
  \`alto\` SMALLINT UNSIGNED NULL,
  \`bytes\` INT UNSIGNED NOT NULL,
  \`hash\` CHAR(16) NOT NULL,
  \`foto\` MEDIUMBLOB NOT NULL,
  \`miniatura\` MEDIUMBLOB NOT NULL,
  \`actualizado\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (\`elemento_id\`) REFERENCES \`elementos\`(\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** Crea `elemento_fotos` si falta. Idempotente: llamarlo en cada arranque es no-op. */
export async function asegurarEsquemaFotos(cfg = conexionDesdeEnv()) {
  await conectar(cfg, (conn) => conn.query(DDL_FOTOS));
}

/**
 * Separa un código en familia y número final: `IOT-79` → `{familia: 'IOT-', n: 79,
 * ancho: 2}`. Un código sin dígitos finales (`FL-MUEX2K8FXZT`) no tiene número
 * (familia null). Pura: la cubre el self-check sin MySQL.
 */
export function partesCodigo(codigo) {
  const m = /^(.*?)(\d+)$/.exec(String(codigo ?? '').trim());
  if (!m) return { familia: null, n: null, ancho: 0 };
  return { familia: m[1], n: Number(m[2]), ancho: m[2].length };
}

/**
 * Siguiente código libre de la MISMA familia: `IOT-79` con 80..87 ocupados →
 * `IOT-88`. Respeta el relleno con ceros (`VL-303-05` → `VL-303-06`, no `6`).
 * Sin dígitos finales la familia es `código + '-'`, para no devolver un código
 * ya usado (`FL-ABC` → `FL-ABC-2`). Pura: el self-check la cubre sin base.
 */
export function siguienteCodigoLibre(codigo, usados = []) {
  const { familia, n, ancho } = partesCodigo(codigo);
  const ocupados = usados instanceof Set ? usados : new Set(usados);
  const base = familia ?? `${String(codigo ?? '').trim()}-`;
  const desde = n == null ? 2 : n + 1;
  for (let i = desde; i < desde + 10_000; i++) {
    const texto = String(i);
    const candidato = `${base}${texto.length < ancho ? texto.padStart(ancho, '0') : texto}`;
    if (!ocupados.has(candidato)) return candidato;
  }
  throw new ErrorApi(`No hay código libre en la familia de ${codigo}`, 500);
}

/**
 * Plan para resolver códigos repetidos. Entrada: TODAS las filas que comparten
 * código (`[{ id, codigo }]`) y los códigos en uso; salida: las recodificaciones
 * a aplicar (`[{ id, de, a }]`).
 *
 * La regla: **el id más bajo conserva el código**. Es el registro que apareció
 * primero —en el Excel original el duplicado siempre es la fila de abajo— y es
 * la única regla que se puede aplicar sin criterio humano y sin mirar el
 * detalle de cada elemento, que es lo que hace falta para reparar una base en el
 * arranque. Los demás reciben el siguiente libre de su propia familia.
 * Pura: el self-check la cubre sin MySQL.
 */
export function planRepararDuplicados(filas, codigosEnUso = []) {
  const ocupados = codigosEnUso instanceof Set ? new Set(codigosEnUso) : new Set(codigosEnUso);
  const grupos = new Map();
  for (const f of filas || []) {
    const codigo = String(f?.codigo ?? '').trim();
    if (!codigo) continue; // NULL/vacío no es un duplicado: sin código no hay etiqueta
    if (!grupos.has(codigo)) grupos.set(codigo, []);
    grupos.get(codigo).push(Number(f.id));
  }
  const plan = [];
  for (const codigo of [...grupos.keys()].sort()) {
    const ids = grupos.get(codigo).sort((a, b) => a - b);
    for (const id of ids.slice(1)) {
      const nuevo = siguienteCodigoLibre(codigo, ocupados);
      ocupados.add(nuevo);
      plan.push({ id, de: codigo, a: nuevo });
    }
  }
  return plan;
}

/** Las filas de los códigos que hoy aparecen más de una vez. */
export async function codigosDuplicados(cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT e.id, e.codigo
      FROM elementos e
      JOIN (SELECT codigo FROM elementos
             WHERE codigo IS NOT NULL AND TRIM(codigo) <> ''
             GROUP BY codigo HAVING COUNT(*) > 1) d ON d.codigo = e.codigo
      ORDER BY e.codigo, e.id`);
    return filas;
  });
}

/**
 * Repara los códigos repetidos que quedan en la base. Es la migración de datos
 * del `IOT-79` heredado, y sirve para cualquier duplicado futuro: la regla es
 * determinista (`planRepararDuplicados`) y esto no hace nada cuando no hay
 * duplicados, así que se puede llamar en cada arranque. Devuelve el plan
 * aplicado para que quien lo llame lo registre (la reversión es un `UPDATE` con
 * el código viejo: se imprime en el log del arranque).
 */
export async function repararCodigosDuplicados(cfg = conexionDesdeEnv()) {
  const repetidos = await codigosDuplicados(cfg);
  if (!repetidos.length) return [];
  return conectar(cfg, async (conn) => {
    const [todos] = await conn.query('SELECT codigo FROM elementos WHERE codigo IS NOT NULL');
    const plan = planRepararDuplicados(repetidos, todos.map((f) => f.codigo));
    if (!plan.length) return plan;
    invalidarCache();
    await conn.beginTransaction();
    try {
      for (const { id, a } of plan) await conn.query('UPDATE elementos SET codigo = ? WHERE id = ?', [a, id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    return plan;
  });
}

/**
 * Deja `codigo` único en la base. Idempotente, se llama en cada arranque:
 *   - crea `uq_codigo` (UNIQUE) si falta;
 *   - ya creado, borra el índice normal `ix_codigo`, que pasó a ser redundante
 *     (un UNIQUE sirve las mismas búsquedas);
 *   - si todavía hay duplicados, MySQL rechaza el UNIQUE (errno 1062) y se
 *     asegura `ix_codigo` para no quedarse sin ningún índice.
 * Devuelve 'creado' | 'ya existía' | 'duplicados' para que el arranque lo diga.
 */
export async function asegurarCodigoUnico(cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    let estado = 'ya existía';
    try {
      await conn.query(DDL_UQ_CODIGO);
      estado = 'creado';
    } catch (e) {
      if (e?.errno === 1062) {
        // Duplicados vivos: la unicidad no se puede delegar a la base todavía.
        try {
          await conn.query(DDL_IX_CODIGO);
        } catch (e2) {
          if (e2?.errno !== 1061) throw e2; // duplicate key name: ya estaba
        }
        codigoUnicoEnBase = false;
        return 'duplicados';
      }
      if (e?.errno === 1061) estado = 'ya existía'; // duplicate key name: ya estaba
      else throw e;
    }
    try {
      await conn.query('DROP INDEX ix_codigo ON elementos');
    } catch (e) {
      if (e?.errno !== 1091) throw e; // 1091: el índice no existía, nada que borrar
    }
    codigoUnicoEnBase = true;
    return estado;
  });
}

const FORMATOS_FOTO = new Set(['image/webp', 'image/jpeg']);
const FIRMAS = {
  'image/webp': [0x52, 0x49, 0x46, 0x46], // "RIFF" (luego viene "WEBP")
  'image/jpeg': [0xff, 0xd8, 0xff],
};

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function decodificar(base64, tipo) {
  const limpio = String(base64 || '')
    .replace(/^data:[^,]+,/, '') // por si llega como data URL
    .replace(/\s+/g, '');
  const bytes = Buffer.from(limpio, 'base64');
  if (!bytes.length) throw new ErrorApi('La foto llegó vacía', 400);
  const firma = FIRMAS[tipo];
  if (!firma.every((b, i) => bytes[i] === b)) {
    throw new ErrorApi(`Los bytes no son una imagen ${tipo}`, 400);
  }
  return bytes;
}

/**
 * Valida y mide lo que mandó el cliente. Pura (sin base), así el self-check la
 * cubre sin MySQL. Devuelve los buffers listos para guardar.
 */
export function validarFoto({ mime, foto, miniatura }) {
  const tipo = String(mime || '').trim().toLowerCase();
  if (!FORMATOS_FOTO.has(tipo)) {
    throw new ErrorApi('Formato de foto no soportado: usa WebP o JPEG', 400);
  }
  const bytes = decodificar(foto, tipo);
  if (bytes.length > LIMITE_FOTO_BYTES) {
    throw new ErrorApi(
      `La foto pesa ${kb(bytes.length)} y el límite es ${kb(LIMITE_FOTO_BYTES)}: redúcela en el dispositivo antes de subirla`,
      413,
    );
  }
  const mini = decodificar(miniatura ?? foto, tipo);
  if (mini.length > LIMITE_MINIATURA_BYTES) {
    throw new ErrorApi(`La miniatura pesa ${kb(mini.length)} y el límite es ${kb(LIMITE_MINIATURA_BYTES)}`, 413);
  }
  if (mini.length >= bytes.length) {
    throw new ErrorApi('La miniatura no puede pesar más que la foto', 400);
  }
  return {
    mime: tipo,
    foto: bytes,
    miniatura: mini,
    // ETag y cache-buster: si la foto cambia, cambia el hash, y el teléfono
    // pide la nueva en vez de revalidar la vieja.
    hash: createHash('sha1').update(bytes).digest('hex').slice(0, 16),
  };
}

export async function guardarFoto(elementoId, datos, cfg = conexionDesdeEnv()) {
  if (!Number.isFinite(Number(elementoId))) throw new ErrorApi('ID de elemento inválido', 400);
  const { mime, foto, miniatura, hash } = validarFoto(datos);
  const ancho = Number.isFinite(Number(datos.ancho)) ? Number(datos.ancho) : null;
  const alto = Number.isFinite(Number(datos.alto)) ? Number(datos.alto) : null;
  invalidarCache();
  cacheFotoLimpiarElemento(elementoId);
  return conectar(cfg, async (conn) => {
    const [[elemento]] = await conn.query('SELECT id FROM elementos WHERE id = ?', [elementoId]);
    if (!elemento) throw new ErrorApi(`El elemento ${elementoId} no existe`, 404);
    const [[actual]] = await conn.query('SELECT elemento_id FROM elemento_fotos WHERE elemento_id = ?', [elementoId]);
    if (actual) {
      await conn.query(
        'UPDATE elemento_fotos SET mime = ?, ancho = ?, alto = ?, bytes = ?, hash = ?, foto = ?, miniatura = ? WHERE elemento_id = ?',
        [mime, ancho, alto, foto.length, hash, foto, miniatura, elementoId],
      );
    } else {
      await conn.query(
        'INSERT INTO elemento_fotos (elemento_id, mime, ancho, alto, bytes, hash, foto, miniatura) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [elementoId, mime, ancho, alto, foto.length, hash, foto, miniatura],
      );
    }
    return {
      guardada: true,
      elemento_id: elementoId,
      hash,
      bytes: foto.length,
      miniatura_bytes: miniatura.length,
      mime,
    };
  });
}

// --- Caché de fotos en RAM ---
// Cada GET de foto pagaba un round-trip a Aiven (~50-150 ms con pool caliente).
// Con el inventario fotografado son los requests más numerosos de la app:
// 171 chips en la sala CNC + fotos de modal + revalidaciones.
//
// Dos niveles:
//  • `hashesFoto`: elemento_id -> {mime, hash}. Lo piden 304/HEAD y el listado;
//    mínimo y barato (~917 × 50 bytes).
//  • LRU `blobFoto` para los bytes: las MINIATURAS caben todas (~917 × 6 KB ≈
//    5 MB) — la sala CNC pinta 171 chips sin tocar la BD. Las fotos grandes
//    (25 KB c/u) se cachean con tope (100 ≈ 2,5 MB): reabrir un modal reciente
//    no re-paga el blob.
// Toda escritura/borrado de fotos limpia las entradas del elemento (los hashes
// cambian con la foto). La coherencia con el cliente no depende de esta caché:
// cada URL lleva el hash como cache-buster.
const hashesFoto = new Map(); // elemento_id -> { mime, hash }
const BLOB_FOTO_MAX = 100;
const blobFoto = new Map(); // "id:tam" -> { mime, hash, datos } (LRU: Map conserva orden)

function cacheFotoGet(elementoId, tam) {
  const key = `${elementoId}:${tam}`;
  const hit = blobFoto.get(key);
  if (!hit) return undefined;
  blobFoto.delete(key); // reinsertar al final = recientemente usado
  blobFoto.set(key, hit);
  return hit;
}

function cacheFotoSet(elementoId, tam, valor) {
  const key = `${elementoId}:${tam}`;
  blobFoto.delete(key);
  blobFoto.set(key, valor);
  while (blobFoto.size > BLOB_FOTO_MAX) {
    const masViejo = blobFoto.keys().next().value;
    blobFoto.delete(masViejo);
  }
}

function cacheFotoLimpiarElemento(elementoId) {
  hashesFoto.delete(elementoId);
  blobFoto.delete(`${elementoId}:foto`);
  blobFoto.delete(`${elementoId}:miniatura`);
}

export async function precargarMiniaturas(cfg = conexionDesdeEnv()) {
  const [filas] = await conectar(cfg, (conn) =>
    conn.query('SELECT elemento_id, mime, hash, miniatura AS datos FROM elemento_fotos'),
  );
  for (const f of filas) {
    hashesFoto.set(f.elemento_id, { mime: f.mime, hash: f.hash });
    cacheFotoSet(f.elemento_id, 'miniatura', { mime: f.mime, hash: f.hash, datos: f.datos });
  }
  return filas.length;
}

/**
 * Solo el hash (y el mime) de la foto, sin leer los blobs. Alcanza para decidir
 * un 304 o responder un HEAD: traer ~30 KB del MEDIUMBLOB para contestar "no
 * cambió" era la parte más lenta de la revalidación (p50 629 ms medidos).
 * Con caché: ni siquiera eso — la revalidación sale de RAM.
 */
export async function obtenerHashFoto(elementoId, cfg = conexionDesdeEnv()) {
  const enCache = hashesFoto.get(elementoId);
  if (enCache) return enCache;
  const fila = await conectar(cfg, async (conn) => {
    const [[fila]] = await conn.query(
      'SELECT mime, hash FROM elemento_fotos WHERE elemento_id = ?',
      [elementoId],
    );
    return fila ?? null;
  });
  if (fila) hashesFoto.set(elementoId, { mime: fila.mime, hash: fila.hash });
  return fila;
}

/** Devuelve los bytes de la foto (o de su miniatura) para servirla tal cual. */
export async function obtenerFoto(elementoId, tam = 'foto', cfg = conexionDesdeEnv()) {
  const columna = tam === 'miniatura' ? 'miniatura' : 'foto';
  const enCache = cacheFotoGet(elementoId, tam);
  if (enCache) return enCache;
  const fila = await conectar(cfg, async (conn) => {
    const [[fila]] = await conn.query(
      `SELECT mime, hash, ${columna} AS datos FROM elemento_fotos WHERE elemento_id = ?`,
      [elementoId],
    );
    return fila ?? null;
  });
  if (fila) {
    hashesFoto.set(elementoId, { mime: fila.mime, hash: fila.hash });
    cacheFotoSet(elementoId, tam, fila);
  }
  return fila;
}

export async function borrarFoto(elementoId, cfg = conexionDesdeEnv()) {
  invalidarCache();
  cacheFotoLimpiarElemento(elementoId);
  return conectar(cfg, async (conn) => {
    const [res] = await conn.query('DELETE FROM elemento_fotos WHERE elemento_id = ?', [elementoId]);
    return { borrada: res.affectedRows > 0, elemento_id: elementoId };
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

// CSV con las mismas columnas que exportarElementos (la cabecera manda). Campos
// entre comillas con "" escapado; BOM y CRLF tolerados. Sin dependencias.
// ponytail: no maneja saltos de línea dentro de un campo entre comillas
// (no aparecen en el export); agregar cuando un detalle los traiga.
export function parsearCsv(texto) {
  const src = texto.replace(/^﻿/, '');
  const filas = [[]];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (comillas) {
      if (c !== '"') campo += c;
      else if (src[i + 1] === '"') { campo += '"'; i++; }
      else comillas = false;
    } else if (c === '"') comillas = true;
    else if (c === ',') { filas.at(-1).push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      filas.at(-1).push(campo);
      campo = '';
      filas.push([]);
    } else campo += c;
  }
  filas.at(-1).push(campo);
  const [cabecera, ...datos] = filas.filter((f) => !(f.length === 1 && f[0].trim() === ''));
  if (!cabecera) return [];
  const claves = cabecera.map((k) => k.trim());
  return datos.map((f) => Object.fromEntries(claves.map((k, j) => [k, f[j] ?? ''])));
}

// NULL y vacío son lo mismo: el export escribe vacío para los nulos, pero la
// hoja original trae la palabra NULL.
const valorOpcional = (x) => {
  const t = String(x ?? '').trim();
  return t === '' || t.toUpperCase() === 'NULL' ? null : t;
};

// Importa solo códigos nuevos. Fila sin código, sala desconocida o código ya en
// uso se omiten y se reportan (no se aborta el lote). Cada inserción valida el
// código en la base, así que no hay ventana de carrera entre el chequeo y el
// INSERT (el 1062 de un duplicado se cuenta como omitido, no aborta el lote).
export async function importarElementos(texto, cfg = conexionDesdeEnv()) {
  const filas = parsearCsv(texto);
  if (!filas.length) throw new ErrorApi('El archivo no tiene filas de datos', 400);
  if (!('codigo' in filas[0]) || !('sala' in filas[0]) || !('edificio' in filas[0])) {
    throw new ErrorApi('Faltan columnas: codigo, sala, edificio', 400);
  }
  invalidarCache();
  return conectar(cfg, async (conn) => {
    const [salas] = await conn.query(
      'SELECT s.id, s.nombre AS sala, e.nombre AS edificio FROM salas s JOIN edificios e ON e.id = s.edificio_id',
    );
    const idSala = new Map(salas.map((s) => [`${s.edificio}|${s.sala}`, s.id]));
    const codigos = filas.map((f) => valorOpcional(f.codigo)).filter(Boolean);
    const enUso = new Set();
    if (codigos.length) {
      const [existentes] = await conn.query('SELECT codigo FROM elementos WHERE codigo IN (?)', [codigos]);
      for (const e of existentes) enUso.add(e.codigo);
    }

    const omitidos = [];
    let importados = 0;
    await conn.beginTransaction();
    try {
      for (const [i, f] of filas.entries()) {
        const fila = i + 2; // +2: la cabecera es la línea 1
        const codigo = valorOpcional(f.codigo);
        if (!codigo) { omitidos.push({ fila, codigo: null, motivo: 'sin código' }); continue; }
        const salaId = idSala.get(`${valorOpcional(f.edificio)}|${valorOpcional(f.sala)}`);
        if (!salaId) {
          omitidos.push({ fila, codigo, motivo: `sala no existe: ${f.edificio} / ${f.sala}` });
          continue;
        }
        if (enUso.has(codigo)) { omitidos.push({ fila, codigo, motivo: 'código ya existe' }); continue; }
        try {
          await conn.query(
            `INSERT INTO elementos (sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              salaId, codigo, valorOpcional(f.detalle), valorOpcional(f.serial), valorOpcional(f.inventario),
              valorOpcional(f.estado), valorOpcional(f.observaciones), valorOpcional(f.cantidad),
            ],
          );
          enUso.add(codigo);
          importados++;
        } catch (e) {
          if (e?.errno !== 1062) throw e;
          omitidos.push({ fila, codigo, motivo: 'código ya existe' });
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    return { importados, omitidos };
  });
}
