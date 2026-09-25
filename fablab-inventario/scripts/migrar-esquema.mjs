#!/usr/bin/env node
// migrar-esquema.mjs — Aplica los cambios de esquema que no están en la base ya
// cargada (el DDL de importer/normalizado.mjs sólo corre al crear la base desde
// cero; en la base viva hay que agregar las piezas nuevas sin borrar datos).
//
// Es idempotente: cada paso comprueba information_schema antes de ejecutar, así
// que se puede correr las veces que haga falta.
//
// Uso:
//   node scripts/migrar-esquema.mjs                          # BD local (Docker, 13306)
//   MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_SSL=1 \
//     node scripts/migrar-esquema.mjs                        # remota (Aiven)
//   node scripts/migrar-esquema.mjs --check                  # sólo dice qué falta
//
// Esquema que aplica:
//   1. Tabla `elemento_fotos` (foto + miniatura por elemento, aparte de la lista).

import { conexionDesdeEnv } from '../importer/importar.mjs';
// La definición vive en importer/api.mjs porque el server la usa para asegurar
// el esquema al arrancar: una sola copia del DDL, no dos que se separan.
import { DDL_FOTOS } from '../importer/api.mjs';

const soloCheck = process.argv.includes('--check');

async function existeTabla(conn, nombre) {
  const [[fila]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [nombre],
  );
  return fila.n > 0;
}

async function main() {
  const cfg = conexionDesdeEnv();
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4' });
  console.log(`base: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);

  try {
    if (await existeTabla(conn, 'elemento_fotos')) {
      console.log('elemento_fotos: ya existe ✔');
    } else if (soloCheck) {
      console.log('elemento_fotos: FALTA (correr sin --check para crearla)');
      process.exitCode = 1;
    } else {
      await conn.query(DDL_FOTOS);
      console.log('elemento_fotos: creada ✔');
    }

    // Estado actual, útil para verificar a ojo
    const [[elementos]] = await conn.query('SELECT COUNT(*) AS n FROM elementos');
    const [[fotos]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM elemento_fotos`,
    ).catch(() => [[{ n: 0, bytes: 0 }]]);
    console.log(`elementos: ${elementos.n} · fotos guardadas: ${fotos.n} (${(Number(fotos.bytes) / 1e6).toFixed(1)} MB)`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
