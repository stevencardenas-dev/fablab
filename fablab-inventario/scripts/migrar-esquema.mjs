#!/usr/bin/env node
// migrar-esquema.mjs — Aplica los cambios de esquema/datos que no están en la
// base ya cargada (el DDL de importer/normalizado.mjs sólo corre al crear la
// base desde cero; en la base viva hay que agregar las piezas nuevas sin borrar
// datos).
//
// Es idempotente: cada paso comprueba el estado antes de ejecutar, así que se
// puede correr las veces que haga falta.
//
// El server hace exactamente esto al arrancar (es su forma de arreglar su
// propia base sin credenciales externas). Este script es la versión manual: útil
// para la base local y para VER qué haría antes de aplicarlo.
//
// Uso:
//   node scripts/migrar-esquema.mjs                          # BD local (Docker, 13306)
//   MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_SSL=1 \
//     node scripts/migrar-esquema.mjs                        # remota (Aiven)
//   node scripts/migrar-esquema.mjs --check                  # sólo dice qué falta
//
// Esquema que aplica:
//   1. Tabla `elemento_fotos` (foto + miniatura por elemento, aparte de la lista).
//   2. Unicidad de `elementos(codigo)`: repara los códigos repetidos heredados
//      (el Excel original repitió `IOT-79`) y crea el índice UNIQUE `uq_codigo`.
//      Sin duplicados, el índice es lo único que hace.

import { conexionDesdeEnv } from '../importer/importar.mjs';
// Las definiciones viven en importer/api.mjs porque el server las usa para
// arreglar el esquema al arrancar: una sola copia, no dos que se separan.
import {
  DDL_FOTOS,
  asegurarCodigoUnico,
  repararCodigosDuplicados,
  codigosDuplicados,
  cerrarPools,
} from '../importer/api.mjs';

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

    // --- Unicidad de elementos(codigo) ---
    const repetidos = await codigosDuplicados(cfg);
    if (repetidos.length) {
      const codigos = [...new Set(repetidos.map((f) => f.codigo))];
      console.log(`códigos duplicados: ${codigos.length} (${codigos.join(', ')}) — filas: ${repetidos.map((f) => f.id).join(', ')}`);
      if (soloCheck) {
        console.log('  (sin --check se reparan: el id más bajo conserva el código)');
        process.exitCode = 1;
      } else {
        const plan = await repararCodigosDuplicados(cfg);
        for (const { id, de, a } of plan) {
          console.log(`  reparado: elemento ${id} · ${de} → ${a}  (reversión: UPDATE elementos SET codigo='${de}' WHERE id=${id})`);
        }
      }
    } else {
      console.log('códigos duplicados: ninguno ✔');
    }

    const estado = await asegurarCodigoUnico(cfg);
    console.log(`índice UNIQUE elementos(codigo): ${estado} ✔`);
    if (estado === 'duplicados') process.exitCode = 1;

    const [indices] = await conn.query(
      `SELECT DISTINCT index_name FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'elementos' ORDER BY index_name`,
    );
    console.log(`índices de elementos: ${indices.map((i) => i.index_name).join(', ')}`);

    // Estado actual, útil para verificar a ojo
    const [[elementos]] = await conn.query('SELECT COUNT(*) AS n FROM elementos');
    const [[fotos]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM elemento_fotos`,
    ).catch(() => [[{ n: 0, bytes: 0 }]]);
    console.log(`elementos: ${elementos.n} · fotos guardadas: ${fotos.n} (${(Number(fotos.bytes) / 1e6).toFixed(1)} MB)`);
  } finally {
    await conn.end();
    // Los pasos de código usan el pool de api.mjs: si queda abierto, node no sale.
    await cerrarPools();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
