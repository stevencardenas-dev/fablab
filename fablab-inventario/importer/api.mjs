// Lectura de la base para el frontend, sobre el esquema normalizado
// (edificios -> salas -> elementos, mas traslados). Ver importer/normalizado.mjs.
import mysql from 'mysql2/promise';
import { conexionDesdeEnv } from './importar.mjs';

async function conectar(cfg, fn) {
  const conn = await mysql.createConnection(cfg);
  try { return await fn(conn); } finally { await conn.end(); }
}

// Salas con su edificio y cuantos elementos tiene cada una.
export async function listarSalas(cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [filas] = await conn.query(`
      SELECT s.id, s.nombre, e.nombre AS edificio, COUNT(el.id) AS elementos
      FROM salas s
      JOIN edificios e ON e.id = s.edificio_id
      LEFT JOIN elementos el ON el.sala_id = s.id
      GROUP BY s.id, s.nombre, e.nombre
      ORDER BY e.nombre, s.nombre`);
    return filas;
  });
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
    if (!salas.length) throw new Error(`La sala "${sala}" no existe`);
    if (salas.length > 1) throw new Error(`"${sala}" existe en mas de un edificio; use el id`);
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
  return conectar(cfg, async (conn) => {
    await conn.beginTransaction();
    try {
      const [[el]] = await conn.query('SELECT sala_id FROM elementos WHERE id = ?', [elementoId]);
      if (!el) throw new Error(`El elemento ${elementoId} no existe`);
      if (el.sala_id === salaNuevaId) throw new Error('El elemento ya esta en esa sala');
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

// Modifica los campos editables de un elemento por id. El codigo NO se toca
// (es el identificador impreso en el Data Matrix); mover de sala es un traslado.
const CAMPOS_EDITABLES = ['detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'];

export async function actualizarElemento(id, campos, cfg = conexionDesdeEnv()) {
  const set = CAMPOS_EDITABLES.filter((c) => campos[c] !== undefined);
  if (!set.length) throw new Error(`Campos editables: ${CAMPOS_EDITABLES.join(', ')}`);
  return conectar(cfg, async (conn) => {
    const [res] = await conn.query(
      `UPDATE elementos SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...set.map((c) => campos[c]), id],
    );
    if (!res.affectedRows) throw new Error(`El elemento ${id} no existe`);
    const [[elemento]] = await conn.query(
      'SELECT id, sala_id, codigo, detalle, serial, inventario, estado, observaciones, cantidad FROM elementos WHERE id = ?',
      [id],
    );
    return { updated: true, elemento };
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

// Elimina un elemento por su codigo.
export async function eliminarElemento(codigo, cfg = conexionDesdeEnv()) {
  return conectar(cfg, async (conn) => {
    const [res] = await conn.query('DELETE FROM elementos WHERE codigo = ?', [codigo]);
    return { deleted: res.affectedRows > 0, codigo };
  });
}
