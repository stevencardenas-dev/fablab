#!/usr/bin/env node
// Genera el SQL del esquema normalizado (Edificios/Salas/Elementos/Traslados) a stdout.
//   node importer/gen-normalizado.mjs "/ruta/CNC 2026.xlsx" > inventario-normalizado.sql
import * as fs from 'node:fs';
import XLSX from 'xlsx';

// xlsx 0.20 (build ESM) no trae acceso a disco: hay que darle `fs` para readFile.
XLSX.set_fs(fs);
import { generarSQL } from './normalizado.mjs';

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node importer/gen-normalizado.mjs <archivo.xlsx>');
  process.exit(1);
}
process.stdout.write(generarSQL(XLSX.readFile(archivo)) + '\n');
