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
      `SELECT id, codigo, detalle, serial, inventario, estado, observaciones, cantidad
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
