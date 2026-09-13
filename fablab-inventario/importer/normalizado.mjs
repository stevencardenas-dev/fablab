// Esquema normalizado: Edificios -> Salas -> Elementos, mas Traslados.
// Alternativa a schema.mjs (una hoja = una tabla). Misma lectura de xlsx.
import { leerHoja } from './schema.mjs';

// Encabezado canonico. Las hojas sin ESTADO (VIVE LAB, ALMACEN 2026) lo dejan NULL.
const CAMPOS = ['codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'];

const ALIAS = { nombre: 'detalle', n_inventario: 'inventario', observacion: 'observaciones' };

function normalizar(h) {
  const k = String(h).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ALIAS[k] || k;
}

export const DDL = `
DROP TABLE IF EXISTS \`traslados\`;
DROP TABLE IF EXISTS \`elementos\`;
DROP TABLE IF EXISTS \`salas\`;
DROP TABLE IF EXISTS \`edificios\`;

CREATE TABLE \`edificios\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`nombre\` VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`salas\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`edificio_id\` INT NOT NULL,
  \`nombre\` VARCHAR(64) NOT NULL,
  UNIQUE KEY \`uq_sala\` (\`edificio_id\`, \`nombre\`),
  FOREIGN KEY (\`edificio_id\`) REFERENCES \`edificios\`(\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ponytail: todo texto salvo las FK. CANTIDAD mezcla '12', '-' e 'INCONTABLE'.
CREATE TABLE \`elementos\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`sala_id\` INT NOT NULL,
  \`codigo\` VARCHAR(64) NULL,
  \`detalle\` VARCHAR(255) NULL,
  \`serial\` VARCHAR(64) NULL,
  \`inventario\` VARCHAR(64) NULL,
  \`estado\` VARCHAR(64) NULL,
  \`observaciones\` VARCHAR(255) NULL,
  \`cantidad\` VARCHAR(64) NULL,
  KEY \`ix_sala\` (\`sala_id\`),
  FOREIGN KEY (\`sala_id\`) REFERENCES \`salas\`(\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`traslados\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`elemento_id\` INT NOT NULL,
  \`sala_anterior_id\` INT NULL,
  \`sala_nueva_id\` INT NOT NULL,
  \`fecha\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`nota\` VARCHAR(255) NULL,
  FOREIGN KEY (\`elemento_id\`) REFERENCES \`elementos\`(\`id\`),
  FOREIGN KEY (\`sala_anterior_id\`) REFERENCES \`salas\`(\`id\`),
  FOREIGN KEY (\`sala_nueva_id\`) REFERENCES \`salas\`(\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`.trim();

function esc(v) {
  return v === '' || v == null ? 'NULL' : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// Mapa hoja -> edificio/sala. Las 7 hojas '* 2026' son FabLab; las 'VIVE LAB-*' son ViveLab.
// ponytail: mapa literal. Los nombres de hoja son irregulares ('VIVE LAB-BODEGA ' con espacio
// final) y derivarlos costaria mas que escribirlos.
export const HOJAS = [
  { nombre: 'CNC 2026', edificio: 'FabLab', sala: 'CNC' },
  { nombre: 'IOT 2026', edificio: 'FabLab', sala: 'IoT' },
  { nombre: 'RV-DRONES 2026', edificio: 'FabLab', sala: 'RV y Drones' },
  { nombre: 'IMPRESION 3D 2026', edificio: 'FabLab', sala: 'Impresion 3D' },
  { nombre: 'COWORKING 2026', edificio: 'FabLab', sala: 'Coworking' },
  { nombre: 'RECEPCION 2026', edificio: 'FabLab', sala: 'Recepcion' },
  { nombre: 'ALMACEN 2026', edificio: 'FabLab', sala: 'Almacen' },
  { nombre: 'VIVE LAB- LAB IMAGEN AULA (305)', edificio: 'ViveLab', sala: 'Lab Imagen (305)' },
  { nombre: 'VIVE LAB-BODEGA ', edificio: 'ViveLab', sala: 'Bodega' },
  { nombre: 'VIVE LAB-AULA 303', edificio: 'ViveLab', sala: 'Aula 303' },
  { nombre: 'VIVE LAB-AULA 304', edificio: 'ViveLab', sala: 'Aula 304' },
];

// hojas: [{ nombre, edificio, sala }], default HOJAS
export function generarSQL(workbook, hojas = HOJAS) {
  const edificios = [...new Set(hojas.map((h) => h.edificio))];
  const partes = [DDL];

  partes.push(`INSERT INTO \`edificios\` (\`nombre\`) VALUES\n${
    edificios.map((e) => `  (${esc(e)})`).join(',\n')};`);

  partes.push(`INSERT INTO \`salas\` (\`edificio_id\`, \`nombre\`) VALUES\n${
    hojas.map((h) => `  ((SELECT \`id\` FROM \`edificios\` WHERE \`nombre\` = ${esc(h.edificio)}), ${esc(h.sala)})`)
      .join(',\n')};`);

  for (const h of hojas) {
    const hoja = leerHoja(workbook, h.nombre);
    if (!hoja.filas.length) continue;
    const idx = {};
    hoja.encabezados.forEach((enc, i) => { idx[normalizar(enc)] = i; });
    const filas = hoja.filas.map((f) => {
      const vals = CAMPOS.map((c) => (idx[c] === undefined ? 'NULL' : esc(f[idx[c]])));
      return `  ((SELECT \`id\` FROM \`salas\` WHERE \`nombre\` = ${esc(h.sala)}), ${vals.join(', ')})`;
    });
    partes.push(`-- ${h.nombre} -> ${h.edificio} / ${h.sala} (${filas.length} filas)`);
    partes.push(`INSERT INTO \`elementos\` (\`sala_id\`, ${CAMPOS.map((c) => `\`${c}\``).join(', ')}) VALUES\n${filas.join(',\n')};`);
  }
  return partes.join('\n\n');
}
