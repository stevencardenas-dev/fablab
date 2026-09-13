// Genera DDL/DML de MySQL a partir de la estructura y el contenido de las hojas del xlsx.
import XLSX from 'xlsx';

// Una hoja es una sala si su primera fila tiene encabezados y hay filas de datos.
// ponytail: el nombre de la tabla se deriva del nombre de la hoja; sin mapa de configuracion
// hasta que aparezca una sala que no se pueda nombrar asi.
export function slug(nombre) {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(base) ? `SALA_${base}` : base || 'SALA';
}

export function columnName(header, i) {
  // No reusa el fallback de slug(): 'SALA' es default de tabla, no de columna.
  const base = String(header)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base && !/^[0-9]/.test(base) ? base : `columna_${i + 1}`;
}

// Ancho maximo observado -> VARCHAR dimensionado, TEXT si se pasa.
// ponytail: todo es texto. El xlsx mezcla '12.0', '-' e 'INCONTABLE' en CANTIDAD,
// asi que tipar numerico perderia datos. Castear cuando la fuente este limpia.
function tipoPara(valores) {
  const max = valores.reduce((m, v) => Math.max(m, v.length), 0);
  if (max > 1000) return 'TEXT';
  return `VARCHAR(${Math.max(32, Math.min(1000, Math.ceil((max || 1) * 1.5)))})`;
}

export function leerHoja(workbook, nombre) {
  const ws = workbook.Sheets[nombre];
  if (!ws) throw new Error(`La hoja "${nombre}" no existe en el archivo`);
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const encabezados = (filas[0] || []).map((h) => String(h).trim());
  const ultimo = encabezados.reduce((n, h, i) => (h ? i : n), -1);
  if (ultimo < 0) return { nombre, encabezados: [], filas: [] };
  const cols = encabezados.slice(0, ultimo + 1);
  const datos = filas
    .slice(1)
    .map((f) => cols.map((_, i) => String(f[i] ?? '').trim()))
    .filter((f) => f.some((v) => v !== ''));
  return { nombre, encabezados: cols, filas: datos };
}

export function ddlDeHoja(hoja) {
  const tabla = slug(hoja.nombre);
  const cols = hoja.encabezados.map((h, i) => {
    const valores = hoja.filas.map((f) => f[i] ?? '');
    return `  \`${columnName(h, i)}\` ${tipoPara(valores)} NULL`;
  });
  return [
    `DROP TABLE IF EXISTS \`${tabla}\`;`,
    `CREATE TABLE \`${tabla}\` (`,
    ['  `id` INT AUTO_INCREMENT PRIMARY KEY', ...cols].join(',\n'),
    `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  ].join('\n');
}

export function dmlDeHoja(hoja) {
  if (!hoja.filas.length) return '';
  const tabla = slug(hoja.nombre);
  const cols = hoja.encabezados.map((h, i) => `\`${columnName(h, i)}\``).join(', ');
  const valores = hoja.filas
    .map((f) => `  (${f.map((v) => (v === '' ? 'NULL' : escapar(v))).join(', ')})`)
    .join(',\n');
  return `INSERT INTO \`${tabla}\` (${cols}) VALUES\n${valores};`;
}

function escapar(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// Hojas candidatas: las que tienen encabezados y al menos una fila de datos.
export function hojasDisponibles(workbook) {
  return workbook.SheetNames.map((n) => leerHoja(workbook, n))
    .filter((h) => h.encabezados.length && h.filas.length)
    .map((h) => ({ nombre: h.nombre, columnas: h.encabezados.length, filas: h.filas.length }));
}
