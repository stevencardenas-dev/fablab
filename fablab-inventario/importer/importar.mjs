// Importa hojas de un xlsx a MySQL: vacia la base actual, crea el DDL y carga el DML.
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import { leerHoja, ddlDeHoja, dmlDeHoja, hojasDisponibles } from './schema.mjs';

export function conexionDesdeEnv(env = process.env) {
  return {
    host: env.MYSQL_HOST || 'localhost',
    port: env.MYSQL_PORT ? Number(env.MYSQL_PORT) : 13306,
    user: env.MYSQL_USER || 'root',
    password: env.MYSQL_PASSWORD || 'fablab',
    database: env.MYSQL_DATABASE || 'fablab',
    socketPath: env.MYSQL_SOCKET || undefined,
    multipleStatements: true,
    // TLS para DBs administradas (Aiven, TiDB...): MYSQL_SSL=1 activa el cifrado.
    // Sin CA, mysql2 valida igual contra la CA del sistema; 'Aiven' acepta su CA propia.
    ...(env.MYSQL_SSL === '1' || env.MYSQL_SSL === 'true'
      ? { ssl: { rejectUnauthorized: env.MYSQL_SSL_STRICT === '1' } }
      : {}),
  };
}

// Vacia la base: borra todas las tablas existentes.
export async function vaciarBase(conn, database) {
  const [tablas] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [database],
  );
  if (!tablas.length) return [];
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t } of tablas) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  return tablas.map((r) => r.t);
}

export function generarSQL(workbook, nombresHojas) {
  const partes = [];
  for (const nombre of nombresHojas) {
    const hoja = leerHoja(workbook, nombre);
    partes.push(`-- Hoja: ${hoja.nombre} (${hoja.filas.length} filas)`);
    partes.push(ddlDeHoja(hoja));
    const dml = dmlDeHoja(hoja);
    if (dml) partes.push(dml);
  }
  return partes.join('\n\n');
}

export async function importar({ archivo, hojas, cfg = conexionDesdeEnv(), soloSQL = false }) {
  const workbook = XLSX.readFile(archivo);
  const disponibles = hojasDisponibles(workbook).map((h) => h.nombre);
  const elegidas = hojas?.length ? hojas : disponibles;
  const faltantes = elegidas.filter((h) => !workbook.SheetNames.includes(h));
  if (faltantes.length) throw new Error(`Hojas no encontradas: ${faltantes.join(', ')}`);

  const sql = generarSQL(workbook, elegidas);
  if (soloSQL) return { sql, hojas: elegidas, borradas: [] };

  // Conecta sin base para poder crearla si no existe.
  const conn = await mysql.createConnection({ ...cfg, database: undefined });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${cfg.database}\``);
    const borradas = await vaciarBase(conn, cfg.database);
    await conn.query(sql);
    return { sql, hojas: elegidas, borradas };
  } finally {
    await conn.end();
  }
}
