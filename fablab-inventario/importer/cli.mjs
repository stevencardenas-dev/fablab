#!/usr/bin/env node
// Uso:
//   node importer/cli.mjs --listar <archivo.xlsx>
//   node importer/cli.mjs --archivo <archivo.xlsx> [--hojas "A,B"] [--sql-only]
import XLSX from 'xlsx';
import { hojasDisponibles } from './schema.mjs';
import { importar, conexionDesdeEnv } from './importar.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const tiene = (n) => args.includes(n);

const archivo = flag('--archivo') || flag('--listar');
if (!archivo) {
  console.error('Falta --archivo <ruta.xlsx> (o --listar <ruta.xlsx>)');
  process.exit(1);
}

if (tiene('--listar')) {
  for (const h of hojasDisponibles(XLSX.readFile(archivo))) {
    console.log(`${h.nombre}\t${h.filas} filas\t${h.columnas} columnas`);
  }
  process.exit(0);
}

const hojas = flag('--hojas')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const soloSQL = tiene('--sql-only');

try {
  const r = await importar({ archivo, hojas, cfg: conexionDesdeEnv(), soloSQL });
  if (soloSQL) { console.log(r.sql); process.exit(0); }
  if (r.borradas.length) console.log(`Tablas eliminadas: ${r.borradas.join(', ')}`);
  console.log(`Importadas ${r.hojas.length} hojas: ${r.hojas.join(', ')}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
