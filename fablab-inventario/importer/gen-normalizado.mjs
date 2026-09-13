#!/usr/bin/env node
// Genera el SQL del esquema normalizado (Edificios/Salas/Elementos/Traslados) a stdout.
//   node importer/gen-normalizado.mjs "/ruta/CNC 2026.xlsx" > inventario-normalizado.sql
import XLSX from 'xlsx';
import { generarSQL } from './normalizado.mjs';

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node importer/gen-normalizado.mjs <archivo.xlsx>');
  process.exit(1);
}
process.stdout.write(generarSQL(XLSX.readFile(archivo)) + '\n');
