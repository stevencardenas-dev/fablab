// Self-check sin MySQL: valida la generacion de DDL/DML desde una hoja sintetica.
// Correr: node importer/self-check.mjs
import assert from 'node:assert';
import XLSX from 'xlsx';
import { slug, columnName, leerHoja, ddlDeHoja, dmlDeHoja, hojasDisponibles } from './schema.mjs';

assert.equal(slug('SALA (309) RV Y DRONES'), 'SALA_309_RV_Y_DRONES');
assert.equal(slug('IMPRESION 3D 2026'), 'IMPRESION_3D_2026');
assert.equal(slug('303 AULA'), 'SALA_303_AULA', 'un nombre que arranca en digito no es tabla valida');
assert.equal(columnName('OBSERVACIONES', 5), 'observaciones');
assert.equal(columnName('', 4), 'columna_5', 'encabezado vacio cae a posicion');

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ['CODIGO', 'DETALLE', 'CANTIDAD'],
    ['A-1', "Mesa d'trabajo", '2'],
    ['A-2', 'Bisturí', 'INCONTABLE'],
    ['', '', ''],
    ['A-3', 'Lámina', ''],
  ]),
  'CNC 2026',
);

const hoja = leerHoja(wb, 'CNC 2026');
assert.equal(hoja.filas.length, 3, 'la fila totalmente vacia se descarta');

const ddl = ddlDeHoja(hoja);
assert.match(ddl, /DROP TABLE IF EXISTS `CNC_2026`/);
assert.match(ddl, /`id` INT AUTO_INCREMENT PRIMARY KEY/);
assert.match(ddl, /`cantidad` VARCHAR/, 'CANTIDAD es texto: convive 2 con INCONTABLE');

const dml = dmlDeHoja(hoja);
assert.match(dml, /'Mesa d''trabajo'/, 'la comilla simple se escapa');
assert.match(dml, /'Bisturí'/, 'el acento sobrevive');
assert.match(dml, /\('A-3', 'Lámina', NULL\)/, 'la celda vacia entra como NULL');

assert.deepEqual(hojasDisponibles(wb), [{ nombre: 'CNC 2026', columnas: 3, filas: 3 }]);

const vacia = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(vacia, XLSX.utils.aoa_to_sheet([['A'], []]), 'Hoja 9');
assert.deepEqual(hojasDisponibles(vacia), [], 'hoja sin datos no es candidata');
assert.equal(dmlDeHoja(leerHoja(vacia, 'Hoja 9')), '', 'sin filas no hay INSERT');

console.log('self-check OK');

// --- esquema normalizado ---
{
  const { DDL, generarSQL } = await import('./normalizado.mjs');
  const wb = {
    SheetNames: ['S1'],
    Sheets: { S1: XLSX.utils.aoa_to_sheet([
      ['CODIGO', 'NOMBRE', 'SERIAL', 'N° INVENTARIO', 'OBSERVACION', 'CANTIDAD'],
      ['A-1', "Fresa 1/2 'media'", 'S1', 'INV-1', 'ok', '2'],
    ]) },
  };
  const sql = generarSQL(wb, [{ nombre: 'S1', edificio: 'FabLab', sala: 'CNC' }]);
  // ALIAS: NOMBRE -> detalle, N° INVENTARIO -> inventario, OBSERVACION -> observaciones
  assert(sql.includes('`detalle`') && sql.includes('`inventario`') && sql.includes('`observaciones`'),
    'normalizado: los alias de encabezado no se aplicaron');
  // La hoja no trae ESTADO: la columna existe igual y va NULL.
  assert(/INSERT INTO `elementos`[\s\S]*NULL/.test(sql), 'normalizado: estado ausente deberia ir NULL');
  assert(sql.includes("'Fresa 1/2 ''media'''"), 'normalizado: comilla simple mal escapada');
  assert(DDL.indexOf('DROP TABLE IF EXISTS `traslados`') < DDL.indexOf('DROP TABLE IF EXISTS `salas`'),
    'normalizado: los DROP deben respetar el orden de las FK');
  console.log('self-check normalizado OK');
}

// api.mjs se valida contra MySQL real (necesita base cargada), no aca.
// Este check solo evita que se rompa el modulo al importarlo.
{
  const api = await import('./api.mjs');
  for (const f of ['listarSalas', 'listarElementos', 'registrarTraslado', 'historialElemento'])
    assert.equal(typeof api[f], 'function', `api.mjs: falta ${f}`);
  console.log('self-check api OK');
}
